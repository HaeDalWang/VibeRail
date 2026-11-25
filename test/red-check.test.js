'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { repo, write, sh, QH, TEST_ENV } = require('./helpers');
const { spawnSync } = require('node:child_process');
// Nested node --test otherwise inherits NODE_TEST_CONTEXT and skips running the test runner.
const env = Object.fromEntries(Object.entries(TEST_ENV).filter(([name]) => name !== 'NODE_TEST_CONTEXT'));
const qh = (root, args) => spawnSync(process.execPath, [QH, ...args], { cwd: root, encoding: 'utf8', env });

const READ = "const assert = require('node:assert/strict'); assert.equal(require('../src/a'), 2);\n";
function project(t, { cmd = 'node --test test/a.test.js', card = '', extra = {} } = {}) {
  const root = repo({ baseRef: 'main', checks: cmd ? { test: { cmd, on: ['pr'], timeoutSec: 2 } } : {},
    common: cmd ? ['test'] : [], answers: { reviewer: { choice: 'C' } } },
  { 'src/a.js': 'module.exports = 1;\n', ...extra });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(qh(root, ['init', root]).status, 0);
  write(root, 'src/a.js', 'module.exports = 2;\n');
  write(root, 'test/a.test.js', READ);
  write(root, '.quality/tasks/work.md', `## 성공 조건 → 검사\n- 확인 → "feature"\n\n## 판단 필요\n- 없음\n\n문서 영향 없음: 내부 동작 검사만 추가함\n${card}`);
  return root;
}
function result(root) {
  const r = qh(root, ['pr']);
  const file = path.join(root, '.quality/evidence/red-check.json');
  assert.ok(fs.existsSync(file), r.stdout + r.stderr);
  return { run: r, ev: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

test('red check blocks always passing tests', (t) => {
  const root = project(t);
  write(root, 'test/a.test.js', "require('node:assert/strict').ok(true);\n");
  const { run, ev } = result(root);
  assert.equal(ev.state, '막음');
  assert.equal(run.status, 1);
  assert.match(run.stdout, /코드 변경을 되돌려도 테스트가 통과한다 → 테스트가 이번 변경을 시험하지 않는다/);
  assert.match(fs.readFileSync(path.join(root, '.quality/reports/review.html'), 'utf8'), /막음/);
});

test('red check passes tests that fail on the base code', (t) => {
  const root = project(t);
  const { ev } = result(root);
  assert.equal(ev.state, '통과', JSON.stringify(ev));
  const state = JSON.parse(qh(root, ['status', '--json', '--pr']).stdout);
  assert.equal(ev.treeHash, state.treeHash);
  assert.doesNotMatch(ev.envError || '', /검사가 파일을 바꿨다/);
});

test('red check reports weak evidence when all reverted files are new', (t) => {
  const root = project(t);
  write(root, 'src/a.js', 'module.exports = 1;\n');
  write(root, 'src/new.js', 'module.exports = 2;\n');
  write(root, 'test/a.test.js', READ.replace('../src/a', '../src/new'));
  assert.equal(result(root).ev.state, '약한 증거');
});

test('red check blocks an untested second seam', (t) => {
  const root = project(t, { card: '## 테스트 위치(seam)\n- src/a.js\n- src/b.js\n', extra: { 'src/b.js': 'module.exports = 1;\n' } });
  write(root, 'src/b.js', 'module.exports = 2;\n');
  const { ev } = result(root);
  assert.equal(ev.state, '막음');
  assert.equal(ev.results.length, 2);
  assert.deepEqual(ev.results.map((r) => r.state), ['통과', '막음']);
});

test('red check reuses the justified no-test waiver', (t) => {
  const root = project(t, { card: '테스트 불필요: 사용자가 정한 단순 변경\n' });
  const { ev } = result(root);
  assert.equal(ev.state, '확인 못 함', JSON.stringify(ev));
  assert.match(ev.detail, /테스트 불필요/);
});

test('red check without a test command is inconclusive', (t) => {
  assert.equal(result(project(t, { cmd: null })).ev.state, '확인 못 함');
});

test('red check without changed code is inconclusive', (t) => {
  const root = project(t);
  write(root, 'src/a.js', 'module.exports = 1;\n');
  assert.equal(result(root).ev.state, '확인 못 함');
});

test('red check preserves worktree and index even when the reversed run fails with a service error', (t) => {
  const root = project(t);
  write(root, 'test/a.test.js', "if (require('../src/a') === 1) { console.error('ECONNREFUSED'); process.exit(1); }\n");
  sh(root, 'git', ['add', 'src/a.js']);
  const before = sh(root, 'git', ['diff', 'HEAD']);
  const index = sh(root, 'git', ['diff', '--cached']);
  const { ev } = result(root);
  assert.equal(ev.state, '확인 못 함', JSON.stringify(ev));
  assert.match(ev.envError, /서비스/);
  assert.equal(sh(root, 'git', ['diff', 'HEAD']), before);
  assert.equal(sh(root, 'git', ['diff', '--cached']), index);
  assert.equal(fs.readFileSync(path.join(root, 'src/a.js'), 'utf8'), 'module.exports = 2;\n');
});

test('red check does not run during check or Stop', (t) => {
  const root = project(t);
  qh(root, ['check', '--pr']);
  qh(root, ['hook', 'stop']);
  assert.ok(!fs.existsSync(path.join(root, '.quality/evidence/red-check.json')));
});

test('red check fills the work tests slot and links ignored dependencies', (t) => {
  const root = project(t, { cmd: 'node --test {tests}', extra: { '.gitignore': 'node_modules/\n' } });
  write(root, 'node_modules/dep/index.js', 'module.exports = 2;\n');
  write(root, 'test/a.test.js', READ.replace('2)', "require('dep'))"));
  const { ev } = result(root);
  assert.equal(ev.state, '통과', JSON.stringify(ev));
});

test('red check cleans its clone and preserves files when restoring base code throws', (t) => {
  const root = project(t);
  const { runRedCheck } = require('../lib/red-check');
  const current = JSON.parse(qh(root, ['status', '--json', '--pr']).stdout);
  const before = sh(root, 'git', ['diff', 'HEAD']);
  let temporary;
  const ev = runRedCheck(root, { ...current, config: JSON.parse(fs.readFileSync(path.join(root, '.quality/config.json'), 'utf8')), card: '', tests: ['test/a.test.js'] }, {
    git(dir, args) {
      temporary = dir;
      if (args[0] === 'restore') throw new Error('restore failed');
      return sh(dir, 'git', args);
    },
  });
  assert.equal(ev.state, '확인 못 함');
  assert.match(ev.envError, /restore failed/);
  assert.equal(sh(root, 'git', ['diff', 'HEAD']), before);
  assert.equal(fs.readFileSync(path.join(root, 'test/a.test.js'), 'utf8'), READ);
  assert.ok(!fs.existsSync(temporary));
});

test('red check uses the test timeout and treats timeout as inconclusive', (t) => {
  const root = project(t);
  write(root, 'test/a.test.js', "if (require('../src/a') === 1) setInterval(() => {}, 1000);\n");
  const { ev } = result(root);
  assert.equal(ev.state, '확인 못 함');
  assert.match(ev.envError, /시간/);
});

test('red check blocks always passing tests even when all code files are new', (t) => {
  const root = project(t);
  write(root, 'src/a.js', 'module.exports = 1;\n');
  write(root, 'src/new.js', 'module.exports = 2;\n');
  write(root, 'test/a.test.js', "require('node:assert/strict').ok(true);\n");
  assert.equal(result(root).ev.state, '막음');
});

test('red check review evidence rejects a record after the original tree changes', (t) => {
  const root = project(t);
  const { ev } = result(root);
  const { readRedCheck } = require('../lib/red-check');
  assert.equal(readRedCheck(root, ev.treeHash).state, '통과');
  assert.equal(readRedCheck(root, 'different-tree').state, '확인 못 함');
});


test('red check accepts a seam if one test command fails while unrelated tests pass', (t) => {
  const root = project(t);
  const file = path.join(root, '.quality/config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  write(root, '.quality/config.json', JSON.stringify({ ...config, checks: { ...config.checks, 'test-other': { cmd: 'node -e "process.exit(0)"' } } }));
  assert.equal(result(root).ev.state, '통과');
});

for (const state of ['통과', '약한 증거', '막음', '확인 못 함']) {
  test(`review test evidence displays red check state ${state} without requiring a success list`, (t) => {
    const root = project(t);
    const { writeReviewPage } = require('../lib/review-page');
    write(root, '.quality/evidence/red-check.json', JSON.stringify({ treeHash: 'current', state, detail: '<test>' }));
    const file = writeReviewPage(root, { base: sh(root, 'git', ['rev-parse', 'main']), treeHash: 'current', card: '', changed: [], checks: [], findings: [] });
    const html = fs.readFileSync(file, 'utf8');
    assert.ok(html.includes(`<b>${state}</b> &lt;test&gt;`));
  });
}

// Rust keeps unit tests at the bottom of the code file: reverting the code must keep the new tests.
test('red check reverts only the code part of a Rust file and keeps its new test part', (t) => {
  const code = 'pub fn one() -> i32 { 1 }\n';
  // Stands in for cargo: the tests fail when they call two() and the code part has no two().
  const fakeCargo = "const s = require('node:fs').readFileSync('src/lib.rs', 'utf8'); const i = s.indexOf('#[cfg(test)]');" +
    " const [c, x] = i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i)]; process.exit(x.includes('two()') && !c.includes('fn two') ? 1 : 0);\n";
  const root = project(t, { cmd: 'node fake-cargo.js', extra: { 'src/lib.rs': code, 'fake-cargo.js': fakeCargo } });
  write(root, 'src/a.js', 'module.exports = 1;\n');
  fs.rmSync(path.join(root, 'test/a.test.js'));
  write(root, 'src/lib.rs', `${code}pub fn two() -> i32 { 2 }\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn two_is_two() { assert_eq!(super::two(), 2); }\n}\n`);
  const { ev } = result(root);
  assert.equal(ev.state, '통과', JSON.stringify(ev));
});
