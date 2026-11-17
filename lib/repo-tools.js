'use strict';

// Whole-repository structure tools, run at PR only (each takes seconds to minutes on a big
// repository, past the Stop budget). Each finding has a stable id; `.quality/baseline.json`
// holds how many of each id the project already had. A PR may not add one. `qh baseline`
// rewrites the file from today's tree; ids that grew there go to a person as a criteria change.
// Off unless config `structure` turns a tool on, and the tool must be installed in the project
// (qh never installs it):
//   unused: true   — knip: unused files, dependencies, exports, an export under two names
//   cycles: true   — dependency-cruiser: modules that import each other in a loop
//   similar: true  — jscpd --similarity: functions with the same shape (renamed copies)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isOwnCode, VENDORED, TEST_FILE } = require('./policy');
const { loadEslint, ToolMissing } = require('./code-shape');

const BASELINE_FILE = '.quality/baseline.json';
const KINDS = ['unused', 'cycles', 'similar'];
const BIN = { unused: 'knip', cycles: 'depcruise', similar: 'jscpd' };
const LABEL = { unused: '미사용', cycles: '순환 참조', similar: '유사 함수' };
const FIX = {
  unused: '안 쓰는 파일·의존성·export는 지운다(`npm uninstall` 포함). 써야 하는 것이면 쓰는 곳을 만든다',
  cycles: '두 모듈이 서로 부르지 않게, 공통 부분을 세 번째 모듈로 뺀다',
  similar: '이름·값만 바꾼 복사본이다. 한곳에 두고 가져다 쓴다',
};
const KNIP_ARGS = ['--include', 'files,dependencies,devDependencies,exports,nsExports,duplicates', '--reporter', 'json'];
const DEPCRUISE_ARGS = ['--no-config', '--exclude', '(^|/)node_modules/', '--output-type', 'json'];
// jscpd's own defaults, pinned: changing them changes every count, so the baseline is retaken.
const SIMILAR_ARGS = ['--format', 'javascript,jsx', '--reporters', 'json', '--silent', '--absolute', '--similarity=0.8', '--min-nodes', '20'];
const JS_FILE = /\.(c|m)?jsx?$/;
const MAX_LISTED = 10;

class ToolError extends Error {}

const enabled = (structure) => KINDS.filter((k) => structure?.[k] === true);

const toolPath = (root, kind) => path.join(root, 'node_modules', '.bin', BIN[kind]);

function run(root, kind, args) {
  const bin = toolPath(root, kind);
  if (!fs.existsSync(bin)) throw new ToolError(`${BIN[kind]}가 프로젝트에 없다(${path.relative(root, bin)}) → devDependencies에 넣고 설치하거나 config structure.${kind}를 끈다`);
  return spawnSync(bin, args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function runJson(root, kind, args) {
  const r = run(root, kind, args);
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new ToolError(`${BIN[kind]} 실패(종료 ${r.status}): ${(r.stderr || r.stdout || '').trim().slice(0, 300)}`);
  }
}

// The working tree as the tools see it: tracked plus new, not ignored.
const tracked = (root) => (spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout || '').split('\n').filter(Boolean);
const codeFiles = (files) => files.filter((f) => JS_FILE.test(f) && isOwnCode(f) && !TEST_FILE.test(f));

// ---------- knip ----------

const RESOLVE_SUFFIXES = ['', '.js', '.jsx', '.cjs', '.mjs', '/index.js', '/index.jsx'];
const SPEC = /(?:require\s*\(\s*|\bfrom\s+|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

// knip does not see CommonJS namespace use (`const svc = require('./svc'); svc.fn()`), so it
// reports those exports as unused. Every repository file that imports a reported file is parsed
// with the project's ESLint (scope analysis, not text match):
//   one name     — `ns.name` / `ns?.name` / `ns['name']` on a variable holding the module
//                  (`const ns = require('./x')`, `import * as ns`), and `require('./x').name`
//   whole file   — the module or that variable used any other way: called, passed on, spread,
//                  re-exported (`module.exports = require('./x')`), `ns[key]`, `mod || require()`;
//                  and every import of a file that does not parse
// Errs toward letting an export through (whole use is generous), never toward a false block.
const memberName = (m) => (!m.computed && m.property.type === 'Identifier' ? m.property.name : m.computed && m.property.type === 'Literal' ? String(m.property.value) : null);
const relativeRequire = (n) => n.callee.type === 'Identifier' && n.callee.name === 'require' && n.arguments.length === 1 && n.arguments[0].type === 'Literal' && typeof n.arguments[0].value === 'string' && n.arguments[0].value.startsWith('.');

function usesRule(at) {
  return {
    create(context) {
      const src = context.sourceCode || context.getSourceCode();
      const declared = (node) => (src.getDeclaredVariables ? src.getDeclaredVariables(node) : context.getDeclaredVariables(node));
      const variables = (vars, target) => {
        for (const v of vars) for (const ref of v.references) {
          if (ref.init || (ref.isWrite() && !ref.isRead())) continue;
          const p = ref.identifier.parent;
          at.mark(target, p.type === 'MemberExpression' && p.object === ref.identifier ? memberName(p) : null);
        }
      };
      return {
        CallExpression(node) {
          if (!relativeRequire(node)) return;
          const target = at.resolve(node.arguments[0].value);
          if (!target) return;
          const p = node.parent;
          if (p.type === 'ExpressionStatement') return; // side effects only
          if (p.type === 'MemberExpression' && p.object === node) at.mark(target, memberName(p));
          else if (p.type === 'VariableDeclarator' && p.init === node) {
            if (p.id.type === 'Identifier') variables(declared(p), target); // destructuring: knip counts it
          } else at.mark(target, null);
        },
        ImportDeclaration(node) {
          const target = at.resolve(node.source.value);
          if (!target) return;
          for (const s of node.specifiers) if (s.type === 'ImportNamespaceSpecifier') variables(declared(s), target);
        },
      };
    },
  };
}

function namespaceUses(root, files, reported) {
  const { Linter } = loadEslint(root);
  const linter = new Linter({ configType: 'flat' });
  const uses = new Map();
  const set = new Set(files);
  const at = {
    from: null,
    resolve(spec) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(this.from), spec));
      return RESOLVE_SUFFIXES.map((s) => base + s).find((p) => set.has(p)) || null;
    },
    mark(target, name) {
      if (!uses.has(target)) uses.set(target, { whole: false, names: new Set() });
      if (name === null) uses.get(target).whole = true;
      else uses.get(target).names.add(name);
    },
  };
  const config = (sourceType) => [{
    files: ['**/*.{js,jsx,cjs,mjs}'], // without it flat config skips .jsx
    languageOptions: { ecmaVersion: 'latest', sourceType, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { qh: { rules: { uses: usesRule(at) } } },
    rules: { 'qh/uses': 'error' },
  }];
  for (const f of files.filter((x) => JS_FILE.test(x) && !VENDORED.test(x))) {
    let text;
    try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    at.from = f;
    const targets = [...text.matchAll(SPEC)].map((m) => at.resolve(m[1])).filter((t) => t && reported.has(t));
    if (!targets.length) continue;
    const parsed = ['module', 'commonjs'].some((t) => !linter.verify(text, config(t), { filename: f }).some((m) => m.fatal));
    if (!parsed) for (const t of targets) at.mark(t, null);
  }
  return uses;
}

function unusedItems(root) {
  const report = runJson(root, 'unused', KNIP_ARGS);
  const issues = report.issues || [];
  const reported = new Set(issues.filter((i) => (i.exports || []).length || (i.nsExports || []).length).map((i) => i.file));
  const uses = reported.size ? namespaceUses(root, tracked(root), reported) : new Map();
  const isUsed = (file, name) => Boolean(uses.get(file)?.whole || uses.get(file)?.names.has(name));
  const ids = [];
  for (const f of report.files || []) ids.push(`안 쓰는 파일 ${typeof f === 'string' ? f : f.name}`);
  for (const issue of issues) {
    if (issue.files === true || (Array.isArray(issue.files) && issue.files.length)) {
      for (const f of Array.isArray(issue.files) ? issue.files : [issue.file]) ids.push(`안 쓰는 파일 ${typeof f === 'string' ? f : f.name || issue.file}`);
    }
    for (const kind of ['dependencies', 'devDependencies']) for (const d of issue[kind] || []) ids.push(`안 쓰는 의존성 ${issue.file} ${d.name}`);
    for (const kind of ['exports', 'nsExports']) for (const e of issue[kind] || []) if (!isUsed(issue.file, e.name)) ids.push(`안 쓰는 export ${issue.file}#${e.name}`);
    for (const group of issue.duplicates || []) ids.push(`두 이름 export ${issue.file}#${group.map((g) => g.name).join('=')}`);
  }
  return ids;
}

// ---------- dependency-cruiser ----------

// Groups of modules that reach each other (strongly connected, Tarjan), plus a self-import.
function cycleGroups(report, files) {
  const keep = new Set(files);
  const graph = new Map();
  for (const mod of report.modules || []) {
    if (!keep.has(mod.source)) continue;
    graph.set(mod.source, [...new Set((mod.dependencies || []).map((d) => d.resolved).filter((r) => keep.has(r)))]);
  }
  const index = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const groups = [];
  const visit = (v) => {
    index.set(v, index.size);
    low.set(v, index.get(v));
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) || []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) !== index.get(v)) return;
    const group = [];
    let w;
    do {
      w = stack.pop();
      onStack.delete(w);
      group.push(w);
    } while (w !== v);
    if (group.length > 1 || (graph.get(v) || []).includes(v)) groups.push(group.sort());
  };
  for (const v of [...graph.keys()].sort()) if (!index.has(v)) visit(v);
  return groups;
}

function cycleItems(root) {
  const files = codeFiles(tracked(root));
  if (!files.length) return [];
  return cycleGroups(runJson(root, 'cycles', [...DEPCRUISE_ARGS, ...files]), files).map((g) => `순환 ${g.join(' ↔ ')}`);
}

// ---------- jscpd ----------

// A pair is named by its two files (sorted), not line numbers, so moving code inside a file
// does not make a new id; the count per pair is what the baseline keeps.
function similarItems(root) {
  const files = codeFiles(tracked(root));
  if (!files.length) return [];
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-jscpd-'));
  try {
    const r = run(root, 'similar', [...files, ...SIMILAR_ARGS, '--output', out]);
    const file = path.join(out, 'jscpd-report.json');
    if (!fs.existsSync(file)) throw new ToolError(`jscpd 실패(종료 ${r.status}): ${(r.stderr || r.stdout || '').trim().slice(0, 300)}`);
    const real = fs.realpathSync(root);
    const rel = (p) => path.relative(real, path.join(fs.realpathSync(path.dirname(p)), path.basename(p))).split(path.sep).join('/');
    return (JSON.parse(fs.readFileSync(file, 'utf8')).duplicates || [])
      .filter((d) => d.kind === 'similar')
      .map((d) => `유사 ${[rel(d.firstFile.name), rel(d.secondFile.name)].sort().join(' ↔ ')}`);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

const MEASURE = { unused: unusedItems, cycles: cycleItems, similar: similarItems };

const tally = (ids) => ids.reduce((m, id) => ({ ...m, [id]: (m[id] || 0) + 1 }), {});

// { kind: { id: count } } for the tools turned on.
function measureAll(root, structure) {
  return Object.fromEntries(enabled(structure).map((k) => [k, tally(MEASURE[k](root))]));
}

// ---------- baseline ----------

function readBaseline(root) {
  // A damaged file (a merge conflict) reads as no baseline: the gate then asks for `qh baseline`.
  const file = path.join(root, BASELINE_FILE);
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  } catch {
    return null;
  }
}

function writeBaseline(root, structure) {
  const now = measureAll(root, structure);
  const sorted = Object.fromEntries(Object.entries(now).map(([k, ids]) => [k, Object.fromEntries(Object.entries(ids).sort(([a], [b]) => a.localeCompare(b)))]));
  fs.mkdirSync(path.dirname(path.join(root, BASELINE_FILE)), { recursive: true });
  fs.writeFileSync(path.join(root, BASELINE_FILE), `${JSON.stringify(sorted, null, 2)}\n`);
  return Object.fromEntries(Object.entries(now).map(([k, ids]) => [k, Object.values(ids).reduce((a, b) => a + b, 0)]));
}

const grown = (before, after) => Object.entries(after || {}).filter(([id, n]) => n > (before?.[id] || 0)).map(([id]) => id);

// PR gate. Returns { problems, env }.
function repoToolProblems(root, structure) {
  const kinds = enabled(structure);
  if (!kinds.length) return { problems: [], env: [] };
  const baseline = readBaseline(root);
  const missing = kinds.filter((k) => !baseline?.[k]);
  if (missing.length) return { problems: [], env: [`${BASELINE_FILE}에 ${missing.join('·')} 기준선이 없다 → \`qh baseline\`으로 지금 상태를 기록하고 커밋한다`] };
  const problems = [];
  try {
    for (const k of kinds) {
      const added = grown(baseline[k], tally(MEASURE[k](root)));
      if (!added.length) continue;
      const shown = added.slice(0, MAX_LISTED).map((id) => `\n    ${id}`).join('');
      problems.push(`${LABEL[k]}: 새로 ${added.length}건${shown}${added.length > MAX_LISTED ? `\n    그 밖 ${added.length - MAX_LISTED}건` : ''}\n    → ${FIX[k]}`);
    }
  } catch (err) {
    if (err instanceof ToolError || err instanceof ToolMissing) return { problems, env: [err.message] };
    throw err;
  }
  return { problems, env: [] };
}

// Criteria change for a person: ids the baseline gained against the base commit.
function baselineChanges(root, base) {
  const now = readBaseline(root);
  if (!now) return [];
  const r = spawnSync('git', ['show', `${base}:${BASELINE_FILE}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return [`${BASELINE_FILE} 처음 기록: 지금 있는 항목을 "기존"으로 받아들인다 → 파일을 한 번 훑는다`];
  let was;
  try { was = JSON.parse(r.stdout); } catch { was = {}; }
  return KINDS.flatMap((k) => {
    const added = grown(was[k], now[k]);
    return added.length ? [`${BASELINE_FILE} ${LABEL[k]} 기준선에 ${added.length}건 추가(새 문제를 기존으로 받아들임): ${added.slice(0, 3).join(', ')}${added.length > 3 ? ' …' : ''}`] : [];
  });
}

module.exports = { repoToolProblems, writeBaseline, baselineChanges, enabled, toolPath, cycleGroups, namespaceUses, BASELINE_FILE, KINDS, ToolError };
