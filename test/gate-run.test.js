'use strict';

// Running checks: what the evidence says when a check misbehaves or its record is damaged.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { repo, write, sh, qh, statusJson, stopDecision, stateOf, DECLARED, BASIC } = require('./helpers');
const repoTools = require('../lib/repo-tools');

const evidence = (root, name) => JSON.parse(fs.readFileSync(path.join(root, '.quality/evidence', `${name}.json`), 'utf8'));
const checkOf = (s, name) => s.checks.find((c) => c.name === name);

test('a check that rewrites a project file is an environment error naming the file', () => {
  const cmd = 'node -e "require(\'fs\').writeFileSync(\'out.txt\', String(Date.now()))"';
  const root = repo({ ...BASIC, checks: { gen: { cmd } }, common: ['gen'] });
  write(root, 'src/a.js', '2');
  qh(root, ['check']);
  const c = checkOf(statusJson(root), 'gen');
  assert.strictEqual(c.state, '환경 오류');
  assert.match(c.detail.join(' '), /검사가 파일을 바꿨다: out\.txt → \.gitignore에 넣거나 출력 경로를 옮긴다/);
});

test('measurement files are not counted as changed files', () => {
  const root = repo(BASIC);
  write(root, '.quality/metrics.csv', 'date\n');
  write(root, '.quality/reports/2026-11-18.html', 'x');
  assert.deepStrictEqual(statusJson(root).changed, []);
});

test('built-in checks get a default time limit under the 120-second hook limit', () => {
  const root = repo(
    { baseRef: 'main', checks: { sql: { builtin: 'sql-prepare', migrations: 'migrations/*.sql', src: ['src/**/*.js'] } }, common: ['sql'] },
    { 'migrations/001.sql': 'CREATE TABLE t (a TEXT);' },
  );
  write(root, 'src/a.js', "db.prepare('SELECT a FROM t');");
  qh(root, ['check']);
  assert.ok(evidence(root, 'sql').timeoutSec < 120, `timeoutSec ${evidence(root, 'sql').timeoutSec}`);
});

test('stop does not rerun a built-in check whose evidence is current', () => {
  const root = repo(
    { baseRef: 'main', checks: { sql: { builtin: 'sql-prepare', migrations: 'migrations/*.sql', src: ['src/**/*.js'] } }, common: ['sql'] },
    { 'migrations/001.sql': 'CREATE TABLE t (a TEXT);' },
  );
  write(root, 'src/a.js', "db.prepare('SELECT a FROM t');");
  write(root, '.quality/tasks/work.md', DECLARED);
  qh(root, ['check']);
  const first = evidence(root, 'sql').startedAt;
  stopDecision(qh(root, ['hook', 'stop'], '{}'));
  assert.strictEqual(evidence(root, 'sql').startedAt, first);
});

test('a command that exits 127 (a tool not found mid-command) is an environment error', () => {
  const root = repo({ ...BASIC, checks: { unit: { cmd: 'true && qh_no_such_tool_abc' } } });
  write(root, 'src/a.js', '2');
  qh(root, ['check']);
  assert.strictEqual(stateOf(statusJson(root), 'unit'), '환경 오류');
});

test('a probe that cannot reach its database is an environment error', () => {
  const root = repo({ baseRef: 'main', checks: { sql: { builtin: 'sql-prepare', src: ['src/**/*.js'] } }, common: ['sql'] }, {
    '.quality/probe.mjs': "export async function sql() { throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }); }\n",
  });
  write(root, 'src/a.js', "db.prepare('SELECT 1');");
  qh(root, ['check']);
  const c = checkOf(statusJson(root), 'sql');
  assert.strictEqual(c.state, '환경 오류');
  assert.match(c.detail.join(' '), /ECONNREFUSED/);
});

test('a damaged evidence or review file counts as not run instead of crashing', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', '2');
  write(root, '.quality/evidence/unit.json', '{"check": "un');
  write(root, '.quality/evidence/review.json', '{');
  const s = statusJson(root);
  assert.strictEqual(stateOf(s, 'unit'), '미실행');
  assert.strictEqual(s.review.state, '미실행');
  assert.strictEqual(qh(root, ['check']).status, 0);
});

test('a damaged structure baseline reads as no baseline instead of crashing', () => {
  const root = repo(BASIC, { [repoTools.BASELINE_FILE]: '{"cycles": {' });
  assert.deepStrictEqual(repoTools.baselineChanges(root, 'main'), []);
  assert.match(repoTools.repoToolProblems(root, { cycles: true }).env.join(' '), /기준선이 없다/);
});

test('a Korean file name is read as written, so its rules apply', () => {
  const root = repo(BASIC);
  write(root, 'src/한글.js', `const k = 'AKIA${'B'.repeat(16)}'\n`);
  write(root, 'docs/설계.md', 'x');
  const s = statusJson(root);
  assert.ok(s.changed.includes('src/한글.js'), s.changed.join(', '));
  assert.match(s.policy.join('\n'), /비밀값 의심: src\/한글\.js:1/);
  assert.doesNotMatch(s.policy.join('\n'), /문서 영향/);
});

test('check exits 3 when environment errors are the only problems', () => {
  const root = repo({ ...BASIC, checks: { gone: { cmd: 'qh-no-such-tool --x' } }, common: ['gone'] });
  write(root, 'src/a.js', '2');
  assert.strictEqual(qh(root, ['check']).status, 3);
});

test('a branch with no common ancestor with the base explains the shallow-clone fix', () => {
  const root = repo(BASIC);
  sh(root, 'git', ['checkout', '-q', '--orphan', 'other']);
  sh(root, 'git', ['commit', '-qm', 'other']);
  sh(root, 'git', ['checkout', '-q', 'work']);
  write(root, '.quality/config.json', JSON.stringify({ ...BASIC, baseRef: 'other' }));
  assert.match(qh(root, ['status']).stdout, /git fetch --unshallow/);
});
