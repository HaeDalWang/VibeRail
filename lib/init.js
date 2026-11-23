'use strict';

// `qh init [project]`: copy qh into <project>/.quality/qh/, then attach it: Claude Code
// and Kiro hooks, the agent rule block, .gitignore, and first drafts of config and
// probe. Never overwrites what a person wrote; files with uncommitted changes stop it.
// Running it again gives the same result (and refreshes the copied qh).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { doctor, duplicateProblems, formatDoctor, MAP_TOOL, MAP_DB } = require('./doctor');
const { DECISIONS_FILE, loadLimits } = require('./policy');
const { METRICS_FILE, REPORTS_DIR } = require('./measure');
const { installSkills, shippedFiles, isInstalledSkill } = require('./skills-install');
const { packageFiles, packageDeps } = require('./questions');

const INSTALL_DIR = '.quality/qh';
// Resolved from the hook's cwd: a session that moved into a worktree of a branch
// older than the qh install finds no qh there, and the hook passes instead of crashing.
const QH_JS = '"$(git rev-parse --show-toplevel 2>/dev/null)/.quality/qh/bin/qh.js"';
const QH_CMD = `[ -f ${QH_JS} ] || exit 0; node ${QH_JS}`;
const MARK_START = '<!-- qh:start -->';
const MARK_END = '<!-- qh:end -->';
// A hook command qh wrote (also a qh run from an absolute path, older manual installs).
const QH_HOOK = /qh\.js"? hook (stop|session-start)\b/;
const NPM_DEFAULT_TEST = 'echo "Error: no test specified" && exit 1';
const HOOKS = [
  { event: 'SessionStart', arg: 'session-start', timeout: 30, name: 'qh session start', description: 'qh 상태와 작업 카드를 문맥에 넣는다.' },
  { event: 'Stop', arg: 'stop', timeout: 120, name: 'qh stop gate', description: '턴 종료 때 내장 검사를 돌리고 증거를 판정한다. 막을 때는 exit 0 + {"decision":"block","reason"}.' },
];

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

const read = (root, rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : null);

// Writes are planned first and applied only after the uncommitted-change check passes.
function write(root, rel, body, plan) {
  const before = plan.get(rel)?.body ?? read(root, rel);
  if (before === body) return;
  plan.set(rel, { body, isNew: read(root, rel) === null });
}

// ---------- detection ----------

const hasNpmTest = (pkg) => Boolean(pkg.scripts?.test && pkg.scripts.test !== NPM_DEFAULT_TEST);
const readJson = (root, rel) => { try { return JSON.parse(read(root, rel) || '{}'); } catch { return {}; } };
// pytest settings live in pyproject.toml, pytest.ini, tox.ini or setup.cfg ([tool:pytest]).
const PYTEST_CONFIG = [['pyproject.toml', /\[tool\.pytest|\bpytest\b/], ['pytest.ini', /./], ['tox.ini', /\[pytest\]/], ['setup.cfg', /\[tool:pytest\]/]];

// The command that runs the project's tests: npm at the top, else packages one folder down
// (backend/, packages/x/), plus pytest and go test where they are set up. null when none.
// ponytail: one folder down only; a deeper monorepo layout gets its command from the person.
function detectTest(root) {
  const cmds = [];
  if (hasNpmTest(readJson(root, 'package.json'))) cmds.push('npm test');
  else {
    for (const f of packageFiles(root).filter((x) => x !== 'package.json')) if (hasNpmTest(readJson(root, f))) cmds.push(`npm --prefix ${path.dirname(f)} test`);
  }
  if (PYTEST_CONFIG.some(([f, re]) => re.test(read(root, f) || '')) || fs.existsSync(path.join(root, 'conftest.py'))) cmds.push('pytest -q');
  if (fs.existsSync(path.join(root, 'go.mod'))) cmds.push('go test ./...');
  return cmds.length ? cmds.join(' && ') : null;
}

function detect(root) {
  const { runtime, all: deps } = packageDeps(root);
  const hasSrc = fs.existsSync(path.join(root, 'src'));
  const sqliteMigrations = fs.globSync('migrations/*.sql', { cwd: root }).length > 0;
  return {
    test: detectTest(root),
    // A server framework only in devDependencies is a test tool, not the app.
    express: Boolean(runtime.express),
    db: deps.pg ? 'postgres' : sqliteMigrations ? 'sqlite' : null,
    src: hasSrc ? ['src/**/*.js', 'src/**/*.mjs', 'src/**/*.cjs', 'src/**/*.ts'] : ['**/*.js', '**/*.mjs'],
    baseRef: baseRef(root),
    hasKiroRun: spawnSync('sh', ['-c', 'command -v kiro-run'], { encoding: 'utf8' }).status === 0,
    hasClaude: spawnSync('sh', ['-c', 'command -v claude'], { encoding: 'utf8' }).status === 0,
  };
}

function baseRef(root) {
  const remoteHead = git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (remoteHead) return remoteHead;
  for (const b of ['main', 'master']) if (git(root, ['rev-parse', '--verify', '--quiet', b])) return b;
  return 'main';
}

// Claude Code headless review (flags as `claude --help` lists them, 2.1): only the read tools
// exist, so it cannot edit files or run commands; the answer comes back as structured output
// and the shell writes it to result.json. No MCP servers (--strict-mcp-config): the task
// forbids reading outside the work folder, and they make every run much larger.
const FINDINGS_SCHEMA = JSON.stringify({
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'line', 'rank', 'severity', 'verdict', 'checklist', 'reason', 'nextAction'],
        properties: {
          file: { type: 'string' }, line: { type: 'integer' }, rank: { type: 'integer' },
          severity: { enum: ['높음', '중간', '낮음'] }, verdict: { enum: ['confirmed', 'doubtful'] },
          checklist: { type: 'string' }, reason: { type: 'string' }, nextAction: { type: 'string' },
        },
      },
    },
  },
});
const TO_RESULT = "let s='';process.stdin.on('data',(d)=>{s+=d}).on('end',()=>process.stdout.write(JSON.stringify(JSON.parse(s).structured_output.findings)))";
const CLAUDE_REVIEW_CMD = `claude -p "$(cat {task})" --tools Read,Grep,Glob --strict-mcp-config --permission-mode dontAsk --no-session-persistence`
  + ` --append-system-prompt '파일 도구는 읽기 전용이다. result.json을 쓰지 말고, 그 배열을 findings에 담아 답한다.'`
  + ` --output-format json --json-schema '${FINDINGS_SCHEMA}' | node -e "${TO_RESULT}" > {out}/result.json`;

function draftConfig(d) {
  const checks = {};
  // The full test suite belongs to the PR: Stop stays fast (decision: under 10 s).
  if (d.test) checks.test = { cmd: d.test, on: ['pr'] };
  if (d.db === 'sqlite') checks.sql = { builtin: 'sql-prepare', migrations: 'migrations/*.sql', src: d.src };
  if (d.db === 'postgres') checks.sql = { builtin: 'sql-prepare', src: d.src, on: ['pr'] };
  if (d.express) {
    // Listing routes needs no database; calling them as each identity may (Postgres).
    checks.routes = { builtin: 'route-access', requests: false };
    checks.access = { builtin: 'route-access', ...(d.db === 'postgres' ? { on: ['pr'] } : {}) };
  }
  const config = { baseRef: d.baseRef, checks, common: Object.keys(checks), risks: {} };
  if (d.hasKiroRun) config.review = { cmd: 'kiro-run {workdir} {task} claude-sonnet-5.5 medium', timeoutSec: 900 };
  else if (d.hasClaude) config.review = { cmd: CLAUDE_REVIEW_CMD, timeoutSec: 900 };
  return `${JSON.stringify(config, null, 2)}\n`;
}

function draftDecisions() {
  const today = new Date().toISOString().slice(0, 10);
  return `# 결정 로그

한 줄에 결정 하나: 날짜 · 결정 · 이유 · 다시 볼 조건. 구조·위험 결정은 docs/adr/NNNN-제목.md에 ADR로 쓰고 여기서 링크한다.

- ${today} · qh로 품질 기준을 \`.quality/config.json\`에 둔다 · 에이전트 작업을 증거로 판정하려고 · 첫 질문 세션에서 검사를 고른 뒤
`;
}

function draftProbe(d) {
  const sqlPart = d.db === 'postgres'
    ? `
// 스키마를 올린 빈 테스트 DB에서 SQL 한 문장을 PREPARE한다. qh pr에서만 돈다.
// placeholder: 템플릿 \${…} 자리에 넣을 값 (Postgres는 'NULL'이 무난하다).
export async function sql() {
  throw todo('sql()')
  // 예: const pool = …테스트 DB 연결…; await migrate(pool)
  //     return { placeholder: 'NULL', prepare: async (text) => { await pool.query(\`PREPARE qh_probe AS \${text}\`); await pool.query('DEALLOCATE qh_probe') }, close: () => pool.end() }
}
`
    : '';
  return `// qh probe: qh가 이 프로젝트의 앱·로그인·DB를 다루는 방법. 프로젝트에 맞게 채운다.
// 계약 전문: .quality/qh/lib/probe.js 머리 주석. 외부 네트워크는 qh가 막는다(loopback만 허용).
// DB·docker처럼 코드 밖의 것이 없을 때는 qhEnv: true 오류를 던져 '환경 오류'로 보고하게 한다.
const todo = (what) => Object.assign(new Error(\`.quality/probe.mjs의 \${what}을 채워야 한다\`), { qhEnv: true })

// requests=false: 라우트 목록만 본다(DB 없이 돌 수 있어야 한다).
// requests=true: qh가 수준별 신원으로 요청을 보낸다. identities = { 수준: 요청 header }.
export async function app({ requests }) {
  throw todo('app()')
  // 예: const { createApp } = await import('../src/app.js')
  //     return { app: createApp(), identities: { member: { 'x-user-id': 'u2' }, admin: { 'x-user-id': 'u1' } }, close: async () => {} }
}
${sqlPart}`;
}

// ---------- attaching ----------

function copyQh(qhHome, root, plan) {
  const dest = path.join(root, INSTALL_DIR);
  if (path.resolve(qhHome) === path.resolve(dest)) return;
  for (const dir of ['bin', 'lib']) {
    for (const f of fs.readdirSync(path.join(qhHome, dir))) {
      write(root, path.join(INSTALL_DIR, dir, f), fs.readFileSync(path.join(qhHome, dir, f), 'utf8'), plan);
    }
  }
  // skills/ rides along so an init run from this copy installs the same skills.
  for (const [rel, body] of shippedFiles(qhHome)) write(root, path.join(INSTALL_DIR, rel), body, plan);
  const { version } = JSON.parse(fs.readFileSync(path.join(qhHome, 'package.json'), 'utf8'));
  // Own package.json: the project may be "type": "module"; qh is CommonJS.
  write(root, path.join(INSTALL_DIR, 'package.json'), `${JSON.stringify({ name: 'qh', version, private: true, type: 'commonjs' }, null, 2)}\n`, plan);
}

function attachClaude(root, plan) {
  const rel = '.claude/settings.json';
  const settings = JSON.parse(read(root, rel) || '{}');
  settings.hooks ||= {};
  for (const h of HOOKS) {
    const entries = (settings.hooks[h.event] ||= []);
    const isOurs = (e) => (e.hooks || []).some((x) => QH_HOOK.test(String(x.command)));
    const ours = { hooks: [{ type: 'command', command: `${QH_CMD} hook ${h.arg}`, timeout: h.timeout }] };
    const at = entries.findIndex(isOurs);
    if (at === -1) entries.push(ours);
    else entries[at] = ours;
  }
  write(root, rel, `${JSON.stringify(settings, null, 2)}\n`, plan);
}

function attachKiro(root, plan) {
  const hooks = HOOKS.map((h) => ({ name: h.name, description: h.description, trigger: h.event, timeout: h.timeout, action: { type: 'command', command: `${QH_CMD} hook ${h.arg}` } }));
  write(root, '.kiro/hooks/qh.json', `${JSON.stringify({ version: 'v1', hooks }, null, 2)}\n`, plan);
}

function attachRules(qhHome, root, plan, notes) {
  const block = `${MARK_START}\n${fs.readFileSync(path.join(qhHome, 'lib', 'agents-snippet.md'), 'utf8').trim().replaceAll('{{REASON_CHARS}}', loadLimits(root).reasonChars)}\n${MARK_END}\n`;
  const agents = read(root, 'AGENTS.md');
  const pattern = new RegExp(`${MARK_START}[\\s\\S]*?${MARK_END}\\n?`);
  const next = agents === null ? block : pattern.test(agents) ? agents.replace(pattern, block) : `${agents.replace(/\n*$/, '\n\n')}${block}`;
  write(root, 'AGENTS.md', next, plan);
  const claude = read(root, 'CLAUDE.md');
  if (claude === null) write(root, 'CLAUDE.md', '@AGENTS.md\n', plan);
  else if (!claude.includes('@AGENTS.md')) notes.push('CLAUDE.md가 AGENTS.md를 불러오지 않는다: Claude Code가 qh 규칙을 보려면 CLAUDE.md에 `@AGENTS.md`가 필요하다 (직접 판단).');
}

// Kept out of git status: the evidence cache, the map settings (they hold this computer's absolute path),
// and the measurement outputs (a copy of Mermaid per report is 2.7 MB).
const IGNORED = ['.quality/evidence/', '.mcp.json', '.kiro/settings/mcp.json', `${REPORTS_DIR}/`, METRICS_FILE];

// Kept out of the code map: qh's own copy and vendored skills are not the person's code to reuse.
const MAP_IGNORED = [`${INSTALL_DIR}/`, '.claude/skills/', '.kiro/skills/'];

// Appends the lines the file lacks, keeping what the person wrote.
function appendMissing(root, file, lines, plan) {
  const text = read(root, file) || '';
  const have = new Set(text.split('\n').map((l) => l.trim()));
  const missing = lines.filter((l) => !have.has(l));
  if (missing.length) write(root, file, `${text.replace(/\n*$/, text ? '\n' : '')}${missing.join('\n')}\n`, plan);
}
const attachGitignore = (root, plan) => appendMissing(root, '.gitignore', IGNORED, plan);

// ---------- entry ----------

// The code map is the agent's way to find existing code before writing new code. Its
// own instruction block is skipped (--no-instructions): qh's AGENTS block carries the
// rule once, instead of a copy in both CLAUDE.md and AGENTS.md.
const MAP_SIDE_EFFECTS = '.git/hooks의 git hook 4개(pre-commit은 커밋마다 code-review-graph update·detect-changes를 돌림), PostToolUse hook, .claude/skills/{debug-issue,explore-codebase,refactor-safely,review-changes}, .mcp.json, .kiro/settings/mcp.json (앞의 둘은 이 컴퓨터의 절대 경로가 들어 있어 .gitignore에 넣음)';
function attachMap(root) {
  const run = (args) => spawnSync('nice', [MAP_TOOL, ...args, '--repo', root], { cwd: root, encoding: 'utf8' });
  if (spawnSync('sh', ['-c', `command -v ${MAP_TOOL}`]).status !== 0) return [];
  const done = [];
  if (!JSON.parse(read(root, '.mcp.json') || '{}').mcpServers?.[MAP_TOOL]) {
    for (const platform of ['claude-code', 'kiro']) run(['install', '-y', '--no-instructions', '--platform', platform]);
    done.push(`${MAP_TOOL} install`);
  }
  if (!fs.existsSync(path.join(root, MAP_DB))) {
    run(['build', '-q']);
    done.push(`${MAP_TOOL} build`);
  }
  return done;
}

function init(qhHome, target) {
  const root = git(path.resolve(target), ['rev-parse', '--show-toplevel']);
  if (!root) {
    console.log(`환경 오류: ${path.resolve(target)}는 git 저장소가 아니다. qh는 git으로 작업 상태를 묶는다 (먼저 git init).`);
    return 3;
  }
  const dups = duplicateProblems(root);
  if (dups.length) {
    console.log(`같은 규칙이나 hook이 두 곳에 있어 멈춤 (그 위에 qh를 얹으면 겹친다):\n${formatDoctor(dups).split('\n').slice(1).join('\n')}`);
    return 1;
  }
  const d = detect(root);
  const plan = new Map();
  const notes = [];
  // Undo may remove the whole install folder only when this run created it.
  const isFreshInstall = !fs.existsSync(path.join(root, INSTALL_DIR));
  copyQh(qhHome, root, plan);
  if (read(root, '.quality/config.json') === null) write(root, '.quality/config.json', draftConfig(d), plan);
  else notes.push('.quality/config.json은 이미 있어 그대로 둠.');
  // Installing qh sets the project's criteria: the first line of its decision log.
  if (read(root, DECISIONS_FILE) === null) write(root, DECISIONS_FILE, draftDecisions(), plan);
  if ((d.express || d.db === 'postgres') && read(root, '.quality/probe.mjs') === null) write(root, '.quality/probe.mjs', draftProbe(d), plan);
  installSkills(qhHome, (rel, body) => write(root, rel, body, plan), (rel) => read(root, rel));
  attachClaude(root, plan);
  attachKiro(root, plan);
  attachRules(qhHome, root, plan, notes);
  attachGitignore(root, plan);
  appendMissing(root, '.code-review-graphignore', MAP_IGNORED, plan);
  // qh's own copy may be refreshed freely; a person's file with uncommitted edits may not.
  const dirty = [...plan].filter(([rel, w]) => !w.isNew && !rel.startsWith(`${INSTALL_DIR}/`) && !isInstalledSkill(qhHome, rel) && git(root, ['status', '--porcelain', '--', rel]));
  if (dirty.length) {
    console.log(`커밋 안 된 변경이 있는 파일을 바꿔야 해서 멈춤 (덮어쓰면 되돌릴 수 없다): ${dirty.map(([rel]) => rel).join(', ')}\n먼저 커밋하거나 치운 뒤 다시 실행.`);
    return 1;
  }
  for (const [rel, w] of plan) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), w.body);
  }
  const mapDone = attachMap(root);
  report(root, d, [...plan].map(([rel, w]) => ({ rel, isNew: w.isNew })), notes, mapDone, isFreshInstall);
  console.log(formatDoctor(doctor(root)));
  console.log(require('./structure').duplicateTotal(root));
  return 0;
}

function report(root, d, log, notes, mapDone, isFreshInstall) {
  // One entry per installed skill folder, not per file.
  const entry = (rel) => rel.replace(/^(\.claude\/skills\/[^/]+)\/.*/, '$1');
  const created = [...new Set(log.filter((l) => l.isNew).map((l) => entry(l.rel)))];
  const changed = [...new Set(log.filter((l) => !l.isNew).map((l) => entry(l.rel)))];
  const tracked = changed.filter((rel) => git(root, ['ls-files', '--error-unmatch', '--', rel]) !== null);
  const createdTop = [...new Set(created.map((rel) => (isFreshInstall && rel.startsWith(`${INSTALL_DIR}/`) ? INSTALL_DIR : rel)))];
  console.log(`qh init: ${root}`);
  console.log(`감지: test=${d.test || '없음'}, express=${d.express ? '예' : '아니오'}, DB=${d.db || '없음'}, 기준=${d.baseRef}`);
  console.log(log.length ? `새로 만듦 ${createdTop.length ? createdTop.join(', ') : '-'}\n바꿈 ${changed.length ? changed.join(', ') : '-'}` : '바뀐 것 없음 (이미 설치됨)');
  if (mapDone.length) console.log(`코드 지도: ${mapDone.join(', ')} 실행 (되돌리기: \`${MAP_TOOL} uninstall --repo .\`)\n코드 지도가 더한 것: ${MAP_SIDE_EFFECTS}`);
  for (const n of notes) console.log(`참고: ${n}`);
  const next = [];
  if (log.some((l) => l.rel === '.quality/probe.mjs')) next.push('.quality/probe.mjs를 채운다 (앱 만들기·로그인·테스트 DB).');
  if (d.express && read(root, '.quality/access.json') === null) next.push('권한 표 첫 버전: `node .quality/qh/bin/qh.js routes --baseline --levels <비로그인>,<…>,<최고> --labels <수준마다 한국어 이름>` 후 사람이 훑는다.');
  if (!d.test) next.push('테스트 검사가 없다: 테스트를 돌리는 명령(npm test·pytest·go test)을 찾지 못했다 → 사용자에게 테스트 실행 방법을 묻고, 허락을 받아 .quality/config.json checks에 test 검사({ "cmd": "…", "on": ["pr"] })와 common에 넣는다.');
  if (!d.hasKiroRun && !d.hasClaude) next.push('AI 리뷰를 쓰려면 .quality/config.json에 review.cmd를 넣는다.');
  next.push('품질 기준 정하기: 에이전트에게 "품질 기준을 같이 정하자"라고 말한다 (몇 가지 질문에 고른 답대로 검사가 켜진다).');
  next.push('확인: `node .quality/qh/bin/qh.js status`');
  console.log(`다음:\n${next.map((n, i) => `  ${i + 1}. ${n}`).join('\n')}`);
  if (log.length) {
    const undo = [tracked.length ? `git checkout -- ${tracked.join(' ')}` : null, createdTop.length ? `rm -rf ${createdTop.join(' ')}` : null].filter(Boolean);
    if (undo.length) console.log(`되돌리기 (저장소 루트에서): ${undo.join(' && ')}`);
  }
}

module.exports = { init, draftConfig, INSTALL_DIR, MARK_START, MARK_END, QH_HOOK, IGNORED };
