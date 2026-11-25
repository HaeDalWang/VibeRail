'use strict';

// Function shape and code-comment rules, read with the project's own ESLint (its parser and
// core rules only; the project's lint config is not used). Off unless config `structure` sets
// `functions` or a `patterns` entry with in: "comments". Judged per changed file against the
// base version: a file may not gain functions over a limit, or comment matches. Files that
// were already over keep what they have (the ratchet); new files start from zero.
//
// structure.functions: { maxLines, componentMaxLines, complexity, maxDepth, maxParams, maxNestedCallbacks }
//   maxLines            — any function longer than this
//   componentMaxLines   — instead of maxLines for names that read as a UI component or hook
//                         (Capitalized, useX); with componentDirs ["src/"], only in files there
//   the rest            — ESLint core rules complexity, max-depth, max-params, max-nested-callbacks
// Two kinds of function are not measured for length: one whose first parameter is `app` or
// `router` (a route-registration wrapper; the handlers inside are measured on their own) and an
// immediately-run function at the top of a file (a module wrapper).

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { isOwnCode, TEST_FILE, MAX_SCAN_BYTES } = require('./policy');

// ponytail: plain JavaScript only (espree); TypeScript needs the project's TS parser wired in.
const JS_FILE = /\.(c|m)?jsx?$/;
const LENGTH_RULE = 'qh/function-length';
const LINT_RULES = { complexity: 'complexity', maxDepth: 'max-depth', maxParams: 'max-params', maxNestedCallbacks: 'max-nested-callbacks' };
const LABELS = { length: '긴 함수', complexity: '분기가 많은 함수', 'max-depth': '중첩이 깊은 곳', 'max-params': '인자가 많은 함수', 'max-nested-callbacks': '콜백이 깊은 곳' };
const FIX = {
  length: '단계별 헬퍼(컴포넌트는 하위 컴포넌트·훅)로 나눈다',
  complexity: '조기 반환·조건 표·헬퍼로 분기를 줄인다',
  'max-depth': '조기 반환·헬퍼로 중첩을 줄인다',
  'max-params': '인자를 옵션 객체 하나로 받는다',
  'max-nested-callbacks': 'async/await나 이름 붙인 함수로 펼친다',
};
const COMPONENT_NAME = /^([A-Z][A-Za-z0-9]*|use[A-Z0-9]\w*)$/;
const MAX_NAME = 40;

class ToolMissing extends Error {}

function loadEslint(root) {
  try {
    return require(require.resolve('eslint', { paths: [root] }));
  } catch {
    throw new ToolMissing('ESLint가 프로젝트에 없다(node_modules/eslint) → `npm i -D eslint` 하거나 config structure.functions·주석 patterns를 뺀다');
  }
}

const short = (text) => text.replace(/\s+/g, ' ').slice(0, MAX_NAME);

function functionName(node, src) {
  if (node.id) return node.id.name;
  const p = node.parent;
  if (p.type === 'VariableDeclarator') return short(src.getText(p.id));
  if (p.type === 'AssignmentExpression') return short(src.getText(p.left));
  if (['Property', 'MethodDefinition', 'PropertyDefinition'].includes(p.type)) return short(src.getText(p.key));
  if (p.type === 'ExportDefaultDeclaration') return 'default';
  if (p.type === 'CallExpression' && p.callee !== node) {
    let outer = p;
    while (outer.parent.type === 'CallExpression') outer = outer.parent;
    if (outer.parent.type === 'VariableDeclarator') return short(src.getText(outer.parent.id));
    return `${short(src.getText(p.callee))} 콜백`;
  }
  return '(이름 없음)';
}

function isWrapper(node) {
  const first = node.params[0];
  if (first?.type === 'Identifier' && (first.name === 'app' || first.name === 'router')) return true;
  const call = node.parent;
  return call.type === 'CallExpression' && call.callee === node && call.parent.type === 'ExpressionStatement' && call.parent.parent.type === 'Program';
}

function lengthRule(limits) {
  return {
    create(context) {
      const src = context.sourceCode || context.getSourceCode();
      const visit = (node) => {
        const lines = node.loc.end.line - node.loc.start.line + 1;
        if (isWrapper(node)) return;
        const name = functionName(node, src);
        const file = (context.filename || context.getFilename()).split(path.sep).join('/');
        const inDirs = !limits.componentDirs || limits.componentDirs.some((d) => file.startsWith(d));
        const limit = limits.componentMaxLines && inDirs && COMPONENT_NAME.test(name) ? limits.componentMaxLines : limits.maxLines;
        if (limit && lines > limit) context.report({ node, message: JSON.stringify({ name, lines, limit }) });
      };
      return { FunctionDeclaration: visit, FunctionExpression: visit, ArrowFunctionExpression: visit };
    },
  };
}

// One Linter for the run. Flat config works on ESLint 8.57+ and 9+.
function makeLinter(root, limits) {
  const { Linter } = loadEslint(root);
  const linter = new Linter({ configType: 'flat' });
  const rules = {};
  if (limits.maxLines || limits.componentMaxLines) rules[LENGTH_RULE] = 'error';
  for (const [key, rule] of Object.entries(LINT_RULES)) if (limits[key]) rules[rule] = ['error', limits[key]];
  const configFor = (sourceType) => [{
    files: ['**/*.{js,jsx,cjs,mjs}'], // without it flat config skips .jsx
    languageOptions: { ecmaVersion: 'latest', sourceType, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { qh: { rules: { 'function-length': lengthRule(limits) } } },
    rules,
  }];
  // ES module first, then CommonJS (top-level return allowed). null when neither parses.
  return (text, file) => {
    for (const sourceType of ['module', 'commonjs']) {
      const messages = linter.verify(text, configFor(sourceType), { filename: file });
      const source = linter.getSourceCode();
      if (source && !messages.some((m) => m.fatal)) return { messages, comments: source.ast.comments };
    }
    return null;
  };
}

// [{ kind, label }] over the limits in one text.
function shapeItems(result) {
  return result.messages.flatMap((m) => {
    if (m.ruleId === LENGTH_RULE) {
      const { name, lines, limit } = JSON.parse(m.message);
      return [{ kind: 'length', label: `${name} ${lines}줄(한도 ${limit})` }];
    }
    return Object.values(LINT_RULES).includes(m.ruleId) ? [{ kind: m.ruleId, label: `${m.line}행 ${m.message.replace(/\s*Maximum allowed is \d+\.$/, '')}` }] : [];
  });
}

const commentCount = (result, re) => result.comments.reduce((n, c) => n + (c.value.match(re) || []).length, 0);

const readAt = (root, base, f) => {
  if (base === null) {
    const file = path.join(root, f);
    if (!fs.existsSync(file) || fs.statSync(file).size > MAX_SCAN_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  }
  const r = spawnSync('git', ['show', `${base}:${f}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : '';
};

const isTarget = (f) => JS_FILE.test(f) && isOwnCode(f);

// Returns { problems, env, skipped }. A file that does not parse now (mid-edit) or at the base is skipped:
// the project's tests and build report syntax, not this rule.
function codeShapeProblems(root, { changed, base, structure = {} }) {
  const limits = structure.functions || null;
  const patterns = (structure.patterns || []).filter((p) => p.in === 'comments');
  const files = changed.filter(isTarget);
  if ((!limits && !patterns.length) || !files.length) return { problems: [], env: [] };
  let lint;
  try {
    lint = makeLinter(root, limits || {});
  } catch (err) {
    if (err instanceof ToolMissing) return { problems: [], env: [err.message] };
    throw err;
  }
  const problems = [];
  const skipped = [];
  for (const f of files) {
    const nowText = readAt(root, null, f);
    if (nowText === null) continue;
    const wasText = readAt(root, base, f);
    const now = lint(nowText, f);
    const was = lint(wasText, f);
    if (!now || !was) skipped.push(f);
    if (limits && now && was && !TEST_FILE.test(f)) {
      const before = Map.groupBy(shapeItems(was), (x) => x.kind);
      for (const [kind, items] of Map.groupBy(shapeItems(now), (x) => x.kind)) {
        const had = before.get(kind)?.length || 0;
        if (items.length > had) problems.push(`함수 모양: ${f} — ${LABELS[kind]} ${had}개 → ${items.length}개 (${items.map((x) => x.label).join(', ')}) → ${FIX[kind]}`);
      }
    }
    for (const p of patterns.filter((x) => !(x.exclude || []).some((d) => f.startsWith(d)))) {
      const re = new RegExp(p.regex, 'gm');
      // A file that does not parse is counted whole, so a reference is never missed.
      const count = (result, text) => (result ? commentCount(result, re) : (text.match(re) || []).length);
      const [a, b] = [count(was, wasText), count(now, nowText)];
      if (b > a) problems.push(`주석 규칙 "${p.name}": ${f}에서 ${a}개 → ${b}개${p.fix ? ` → ${p.fix}` : ''}`);
    }
  }
  return { problems, env: [], skipped };
}

module.exports = { codeShapeProblems, loadEslint, ToolMissing };
