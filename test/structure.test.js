'use strict';

// Structure ratchet rules that a project turns on in config `structure`. Each rule: the
// worsening it exists for blocks, and with no config it does nothing.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { cycleGroups, namespaceUses } = require('../lib/repo-tools');

const QH = path.join(__dirname, '..', 'bin', 'qh.js');
const ESLINT = path.join(__dirname, '..', 'node_modules', 'eslint');
const BASIC = { baseRef: 'main', checks: { unit: { cmd: 'node -e "process.exit(0)"' } }, common: ['unit'] };

const sh = (cwd, cmd, args) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const write = (root, rel, body) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};

// A repository on branch `work` off `main`; `tools` links the real ESLint and/or writes fake
// whole-repository tools into node_modules/.bin (not tracked, like a real install).
function repo(structure, files = {}, { eslint = false, bins = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-structure-'));
  sh(root, 'git', ['init', '-q', '-b', 'main']);
  sh(root, 'git', ['config', 'user.email', 't@example.invalid']);
  sh(root, 'git', ['config', 'user.name', 't']);
  write(root, '.quality/config.json', JSON.stringify(structure === undefined ? BASIC : { ...BASIC, structure }));
  write(root, '.gitignore', 'node_modules/\n.quality/evidence/\n');
  write(root, 'src/a.js', '1');
  for (const [rel, body] of Object.entries(files)) write(root, rel, body);
  if (eslint) {
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    fs.symlinkSync(ESLINT, path.join(root, 'node_modules', 'eslint'));
  }
  for (const [name, body] of Object.entries(bins)) {
    write(root, `node_modules/.bin/${name}`, body);
    fs.chmodSync(path.join(root, `node_modules/.bin/${name}`), 0o755);
  }
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'init']);
  sh(root, 'git', ['checkout', '-qb', 'work']);
  return root;
}

const qh = (root, args) => spawnSync(process.execPath, [QH, ...args], { cwd: root, encoding: 'utf8' });
function status(root, phase = 'stop') {
  const r = qh(root, ['status', '--json', ...(phase === 'pr' ? ['--pr'] : [])]);
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const structureOf = (root, phase) => status(root, phase).structure.join('\n');
const commit = (root) => {
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'c']);
};

// ---------- file-local rules (Stop and PR) ----------

test('a new file directly under a flat root blocks; subfolders, old files and declared ones pass', () => {
  const root = repo({ flatRoots: ['src/widgets'] }, { 'src/widgets/old.js': '1' });
  write(root, 'src/widgets/old.js', '2');
  write(root, 'src/widgets/cart/item.js', '1');
  assert.doesNotMatch(structureOf(root), /정리 대상 폴더/);
  write(root, 'src/widgets/new.js', '1');
  assert.match(structureOf(root), /정리 대상 폴더: src\/widgets\/ 바로 아래 새 파일 src\/widgets\/new\.js/);
  write(root, 'docs/decisions.md', '- 루트 파일: src/widgets/new.js · 진입점\n');
  assert.doesNotMatch(structureOf(root), /정리 대상 폴더/);
});

test('a listed document may not grow unless the decision log allows it', () => {
  const root = repo({ noGrow: ['DEPLOY.md'] }, { 'DEPLOY.md': 'a\nb\n' });
  write(root, 'DEPLOY.md', 'a\nc\n');
  assert.doesNotMatch(structureOf(root), /문서 증가/, 'rewriting in place is fine');
  write(root, 'DEPLOY.md', 'a\nb\nc\n');
  assert.match(structureOf(root), /문서 증가: DEPLOY\.md가 2줄 → 3줄/);
  write(root, 'docs/decisions.md', '- 문서 증가 허용: DEPLOY.md · 새 환경\n');
  assert.doesNotMatch(structureOf(root), /문서 증가/);
});

test('a listed document may not grow in bytes either, even on the same line count', () => {
  const root = repo({ noGrow: ['AGENTS.md'] }, { 'AGENTS.md': 'short\n' });
  write(root, 'AGENTS.md', 'a much longer line\n');
  assert.match(structureOf(root), /문서 증가: AGENTS\.md가 1줄 → 1줄\(6 → 19바이트\)/);
});

test('deleting a file a document points at blocks, even when that document is untouched', () => {
  const root = repo({ backtickRefs: true }, { 'src/gone.js': '1', 'docs/guide.md': 'run `src/gone.js` or [it](../src/gone.js); `src/old-dead.js`\n' });
  fs.rmSync(path.join(root, 'src/gone.js'));
  const st = structureOf(root);
  assert.match(st, /죽은 링크: docs\/guide\.md:1 → `src\/gone\.js`/);
  assert.match(st, /죽은 링크: docs\/guide\.md:1 → \.\.\/src\/gone\.js/);
  assert.doesNotMatch(st, /old-dead/, 'old dead references in untouched documents are not this work\'s');
});

test('the files qh init writes have no dead backtick paths when backtickRefs is on', () => {
  const root = repo(undefined, { 'package.json': '{}' });
  assert.strictEqual(qh(root, ['init', root]).status, 0);
  const config = JSON.parse(fs.readFileSync(path.join(root, '.quality/config.json'), 'utf8'));
  write(root, '.quality/config.json', JSON.stringify({ ...config, structure: { backtickRefs: true } }));
  assert.doesNotMatch(structureOf(root), /죽은 링크/);
});

test('status --base compares against that ref instead of config.baseRef', () => {
  const root = repo({ forbidden: ['docs/plans/'] });
  write(root, 'docs/plans/x.md', 'x');
  commit(root);
  assert.match(structureOf(root), /금지 위치: docs\/plans\/x\.md/);
  const r = qh(root, ['status', '--json', '--base', 'HEAD']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout).structure, []);
  assert.strictEqual(JSON.parse(r.stdout).baseRef, 'HEAD');
});

test('a new file under a forbidden folder blocks', () => {
  const root = repo({ forbidden: ['docs/plans/'] });
  write(root, 'docs/plans/x.md', 'x');
  assert.match(structureOf(root), /금지 위치: docs\/plans\/x\.md/);
});

test('a docs pattern blocks when its count grows, outside fences and excluded folders', () => {
  const root = repo({ patterns: [{ name: '티켓 참조', regex: 'TICKET-\\d+', in: 'docs', exclude: ['docs/reports/'], fix: '티켓 번호 대신 내용을 쓴다' }] }, { 'docs/a.md': 'TICKET-1\n' });
  write(root, 'docs/a.md', 'TICKET-2\n```\nTICKET-3\n```\n');
  write(root, 'docs/reports/r.md', 'TICKET-4 TICKET-5\n');
  assert.doesNotMatch(structureOf(root), /티켓 참조/, 'same count outside fences; reports excluded');
  write(root, 'docs/a.md', 'TICKET-2 TICKET-6\n');
  assert.match(structureOf(root), /문서 규칙 "티켓 참조".*docs\/a\.md.*1.*2[\s\S]*티켓 번호 대신/);
});

test('a backtick path in a changed doc must exist, placeholders and globs aside', () => {
  const root = repo({ backtickRefs: ['lib'] }, { 'lib/util.js': '1' });
  write(root, 'docs/a.md', 'see `src/a.js`, `src/<name>.js`, `src/*.js`, `util.js` and `src/gone.js`\n```\n`src/fenced.js`\n```\n');
  const st = structureOf(root);
  assert.match(st, /죽은 링크: docs\/a\.md:1 → `src\/gone\.js`/);
  assert.doesNotMatch(st, /src\/a\.js`|<name>|\*\.js|util\.js|fenced/);
});

test('with no structure config none of the configurable rules run', () => {
  const big = Array.from({ length: 200 }, (_, i) => `  call${i}();`).join('\n');
  const root = repo(undefined, { 'src/widgets/old.js': '1', 'DEPLOY.md': 'a\n' }, { eslint: true });
  write(root, 'src/widgets/new.js', `// TICKET-1\nfunction f(a, b, c, d, e, f2) {\n${big}\n}\n`);
  write(root, 'DEPLOY.md', 'a\nb\n');
  write(root, 'docs/plans/x.md', 'TICKET-9 `src/gone.js`\n');
  assert.doesNotMatch(structureOf(root, 'pr'), /정리 대상|문서 증가|금지 위치|문서 규칙|주석 규칙|함수 모양|gone\.js|미사용|순환|유사/);
});

// ---------- function shape (ESLint, Stop and PR) ----------

const LIMITS = { functions: { maxLines: 10, componentMaxLines: 20, complexity: 3, maxDepth: 2, maxParams: 3, maxNestedCallbacks: 2 } };
const body = (n) => Array.from({ length: n }, (_, i) => `  step${i}();`).join('\n');

test('a file may not gain a function over a limit; one already over is kept', () => {
  const root = repo(LIMITS, { 'src/old.js': `function old() {\n${body(12)}\n}\n` }, { eslint: true });
  write(root, 'src/old.js', `function old() {\n${body(13)}\n}\n`);
  assert.doesNotMatch(structureOf(root), /함수 모양/, 'the same one long function is not new');
  write(root, 'src/new.js', `function add(a, b, c, d) {\n  if (a) { if (b) { if (c) return d; } }\n  return a || b || c;\n}\nfunction Panel() {\n${body(15)}\n}\nfunction useThing() {\n${body(25)}\n}\nmodule.exports = (app) => {\n${body(30)}\n};\n`);
  const st = structureOf(root);
  assert.match(st, /함수 모양: src\/new\.js — 긴 함수 0개 → 1개 \(useThing 27줄\(한도 20\)\)/, 'components and hooks get the larger limit; a route wrapper is not measured');
  assert.match(st, /src\/new\.js — 인자가 많은 함수 0개 → 1개/);
  assert.match(st, /src\/new\.js — 중첩이 깊은 곳 0개 → 1개/);
  assert.match(st, /src\/new\.js — 분기가 많은 함수 0개 → 1개/);
});

test('the component limit applies only under componentDirs when set', () => {
  const root = repo({ functions: { maxLines: 10, componentMaxLines: 20, componentDirs: ['src/'] } }, {}, { eslint: true });
  write(root, 'src/Panel.js', `function Panel() {\n${body(15)}\n}\n`);
  write(root, 'server/Job.js', `function Job() {\n${body(15).replaceAll('step', 'job')}\n}\n`);
  const st = structureOf(root);
  assert.doesNotMatch(st, /src\/Panel\.js/);
  assert.match(st, /server\/Job\.js — 긴 함수 0개 → 1개 \(Job 17줄\(한도 10\)\)/);
});

test('a .jsx component is read too (JSX syntax, flat config file match)', () => {
  const root = repo(LIMITS, {}, { eslint: true });
  write(root, 'src/Card.jsx', `export function Card() {\n${body(25)}\n  return <div className="card">x</div>;\n}\n`);
  assert.match(structureOf(root), /함수 모양: src\/Card\.jsx — 긴 함수 0개 → 1개 \(Card 28줄\(한도 20\)\)/);
});

test('callbacks nested past the limit block, and test files are not held to function limits', () => {
  const root = repo(LIMITS, {}, { eslint: true });
  write(root, 'src/cb.js', 'a(() => { b(() => { c(() => { d(); }); }); });\n');
  write(root, 'test/x.test.js', `test('x', () => {\n${body(30)}\n});\n`);
  const st = structureOf(root);
  assert.match(st, /src\/cb\.js — 콜백이 깊은 곳 0개 → 1개/);
  assert.doesNotMatch(st, /x\.test\.js/);
});

test('a comment pattern counts comments only, not strings', () => {
  const root = repo({ patterns: [{ name: '코드 티켓', regex: 'TICKET-\\d+', in: 'comments' }] }, { 'src/t.js': '// TICKET-1\n' }, { eslint: true });
  write(root, 'src/t.js', '// TICKET-1\nconst id = "TICKET-2";\n');
  assert.doesNotMatch(structureOf(root), /주석 규칙/);
  write(root, 'src/t.js', '// TICKET-1\n/* TICKET-2 */\n');
  assert.match(structureOf(root), /주석 규칙 "코드 티켓": src\/t\.js에서 1개 → 2개/);
});

test('a file that does not parse is counted whole for comment patterns', () => {
  const root = repo({ patterns: [{ name: '코드 티켓', regex: 'TICKET-\\d+', in: 'comments' }] }, {}, { eslint: true });
  write(root, 'src/broken.js', 'function ( { // TICKET-1\n');
  assert.match(structureOf(root), /주석 규칙 "코드 티켓": src\/broken\.js에서 0개 → 1개/);
});

test('function limits without ESLint in the project are an environment error, and doctor fails', () => {
  const root = repo(LIMITS);
  write(root, 'src/x.js', 'function f() {}\n');
  const s = status(root);
  assert.match(s.structureEnv.join('\n'), /ESLint가 프로젝트에 없다/);
  assert.match(qh(root, ['doctor']).stdout, /node_modules\/eslint가 없다/);
});

// ---------- whole-repository tools (PR only, against .quality/baseline.json) ----------

// Fake tools print what the fixture files say, so the test controls each report.
const FAKE = {
  knip: '#!/bin/sh\ncat fake-knip.json\n',
  depcruise: '#!/bin/sh\ncat fake-dep.json\n',
  jscpd: `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const out = process.argv[process.argv.indexOf('--output') + 1];
const pairs = JSON.parse(fs.readFileSync('fake-similar.json', 'utf8'));
const duplicates = pairs.map(([a, b]) => ({ kind: 'similar', firstFile: { name: path.resolve(a) }, secondFile: { name: path.resolve(b) } }));
fs.writeFileSync(path.join(out, 'jscpd-report.json'), JSON.stringify({ duplicates }));
`,
};
const TOOLS = { unused: true, cycles: true, similar: true };
const knip = (issues) => JSON.stringify({ files: [], issues });
const dep = (edges) => JSON.stringify({ modules: Object.entries(edges).map(([source, to]) => ({ source, dependencies: to.map((resolved) => ({ resolved })) })) });
const START = {
  'fake-knip.json': knip([{ file: 'src/a.js', exports: [{ name: 'old' }] }]),
  'fake-dep.json': dep({ 'src/a.js': [], 'src/b.js': [] }),
  'fake-similar.json': '[]',
  'src/b.js': '1',
};

function toolRepo() {
  const root = repo(TOOLS, START, { bins: FAKE, eslint: true });
  assert.strictEqual(qh(root, ['baseline']).status, 0);
  commit(root);
  sh(root, 'git', ['checkout', '-q', 'main']);
  sh(root, 'git', ['merge', '-q', 'work']);
  sh(root, 'git', ['checkout', '-qb', 'work2']);
  return root;
}

test('without a baseline the PR tools are an environment error, and doctor says to take one', () => {
  const root = repo(TOOLS, START, { bins: FAKE });
  write(root, 'src/a.js', '2');
  assert.match(status(root, 'pr').structureEnv.join('\n'), /baseline\.json에 unused·cycles·similar 기준선이 없다/);
  assert.match(qh(root, ['doctor']).stdout, /`qh baseline` 실행 후 커밋/);
});

test('the whole-repository tools run at PR only and block items the baseline does not have', () => {
  const root = toolRepo();
  write(root, 'src/a.js', '2');
  assert.deepStrictEqual(status(root, 'pr').structure, [], 'baseline items are "already there"');
  write(root, 'fake-knip.json', knip([{ file: 'src/a.js', exports: [{ name: 'old' }, { name: 'fresh' }], dependencies: [{ name: 'left-pad' }] }, { file: 'package.json', duplicates: [[{ name: 'x' }, { name: 'y' }]] }]));
  write(root, 'fake-dep.json', dep({ 'src/a.js': ['src/b.js'], 'src/b.js': ['src/a.js'] }));
  write(root, 'fake-similar.json', JSON.stringify([['src/b.js', 'src/a.js']]));
  assert.doesNotMatch(structureOf(root), /미사용|순환|유사/, 'not at Stop: too slow');
  const st = structureOf(root, 'pr');
  assert.match(st, /미사용: 새로 3건[\s\S]*안 쓰는 의존성 src\/a\.js left-pad[\s\S]*안 쓰는 export src\/a\.js#fresh[\s\S]*두 이름 export package\.json#x=y/);
  assert.doesNotMatch(st, /#old/);
  assert.match(st, /순환 참조: 새로 1건\n {4}순환 src\/a\.js ↔ src\/b\.js/);
  assert.match(st, /유사 함수: 새로 1건\n {4}유사 src\/a\.js ↔ src\/b\.js/);
});

test('an export used through a CommonJS namespace is not reported as unused', () => {
  const root = toolRepo();
  write(root, 'src/use.js', "const a = require('./a');\na.fresh();\n");
  write(root, 'fake-knip.json', knip([{ file: 'src/a.js', exports: [{ name: 'old' }, { name: 'fresh' }] }]));
  assert.doesNotMatch(structureOf(root, 'pr'), /미사용/);
});

test('growing the baseline goes to a person as a criteria change', () => {
  const root = toolRepo();
  write(root, 'fake-dep.json', dep({ 'src/a.js': ['src/b.js'], 'src/b.js': ['src/a.js'] }));
  assert.strictEqual(qh(root, ['baseline']).status, 0);
  const s = status(root, 'pr');
  assert.deepStrictEqual(s.structure, []);
  assert.match(s.configChanges.join('\n'), /baseline\.json 순환 참조 기준선에 1건 추가/);
});

test('a tool turned on but not installed fails doctor; qh baseline with no tool turned on refuses', () => {
  const root = repo({ cycles: true });
  assert.match(qh(root, ['doctor']).stdout, /structure\.cycles가 켜졌는데 node_modules\/\.bin\/depcruise가 없다/);
  const off = repo(undefined);
  assert.strictEqual(qh(off, ['baseline']).status, 1);
});

test('cycle groups are strongly connected modules, a self-import included', () => {
  const report = JSON.parse(dep({ a: ['b'], b: ['c'], c: ['a'], d: ['d'], e: ['a'] }));
  assert.deepStrictEqual(cycleGroups(report, ['a', 'b', 'c', 'd', 'e']), [['a', 'b', 'c'], ['d']]);
});

test('namespace use marks names, and any other use of the module marks the whole file', () => {
  const files = {
    'src/svc.js': '',
    'src/x.js': "const svc = require('./svc');\nsvc.run(); svc?.stop(); svc['go']();\nrequire('./svc').once();\nfunction f(svc) { return svc; }\n",
    'src/y.js': "const m = require('./svc.js');\nhandle(m);\n",
    'src/call.js': "require('./svc')(app, ctx);\n",
    'src/reexport.js': "module.exports = require('./svc');\n",
    'src/lazy.js': "let mod;\nconst get = () => mod || require('./svc');\n",
    'src/effect.js': "require('./svc');\n",
    'src/broken.js': "const svc = require('./svc');\nsvc.run( {\n",
  };
  const root = repo(undefined, files, { eslint: true });
  const use = (...importers) => namespaceUses(root, ['src/svc.js', ...importers], new Set(['src/svc.js'])).get('src/svc.js');
  const one = use('src/x.js');
  assert.deepStrictEqual([...one.names].sort(), ['go', 'once', 'run', 'stop']);
  assert.strictEqual(one.whole, false, 'a parameter with the same name is another variable');
  for (const f of ['src/y.js', 'src/call.js', 'src/reexport.js', 'src/lazy.js', 'src/broken.js']) assert.strictEqual(use(f).whole, true, f);
  assert.strictEqual(use('src/effect.js'), undefined, 'a side-effect require uses nothing');
});

// ---------- measure ----------

test('measure counts flat-root files only where configured, minus declared ones', () => {
  const root = repo({ flatRoots: ['src/widgets'] }, { 'src/widgets/a.js': '1', 'src/widgets/b.js': '1', 'src/widgets/sub/c.js': '1', 'docs/decisions.md': '- 루트 파일: src/widgets/b.js · 진입점\n' });
  assert.strictEqual(qh(root, ['measure']).status, 0);
  const [head, row] = fs.readFileSync(path.join(root, '.quality/metrics.csv'), 'utf8').trim().split('\n').map((l) => l.split(','));
  assert.strictEqual(row[head.indexOf('flat_root_files')], '1');
  const plain = repo(undefined);
  qh(plain, ['measure']);
  assert.doesNotMatch(fs.readFileSync(path.join(plain, '.quality/metrics.csv'), 'utf8'), /flat_root_files/);
});
