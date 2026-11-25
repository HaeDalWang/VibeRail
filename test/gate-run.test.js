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

for (const [format, log, expected] of [
  ['node TAP', 'not ok 2 - returns empty\n  not ok 3 - nested test\n', ['returns empty', 'nested test']],
  ['node spec', '✖ returns empty (12.4ms)\n✖ failing tests:\n✖ returns empty (12.4ms)\n', ['returns empty']],
  ['jest', '  ✕ returns empty (4 ms)\n  ● Suite › name\n', ['returns empty', 'Suite › name']],
  ['pytest', 'FAILED test/a.py::test_empty - AssertionError\n', ['test/a.py::test_empty']],
  ['jest suite failure', 'FAIL test/first.js\n  ● Test suite failed to run\nFAIL test/second.js\n  ● Test suite failed to run\n  ● Suite › old', ['test/first.js › Test suite failed to run', 'test/second.js › Test suite failed to run', 'Suite › old']],
  ['pytest collection error', 'FAILED test/a.py::test_old\nERROR test/b.py - ImportError\nERROR test/c.py::TestCase - error', ['test/a.py::test_old', 'ERROR test/b.py', 'ERROR test/c.py::TestCase']],
  ['go build and setup failure', '--- FAIL: TestOld (0.00s)\nFAIL\tpkg/build [build failed]\nFAIL\tpkg/setup [setup failed]', ['TestOld', 'pkg/build [build failed]', 'pkg/setup [setup failed]']],
  ['go', '--- FAIL: TestEmpty (0.00s)\n    --- FAIL: TestEmpty/nested (0.00s)\n', ['TestEmpty', 'TestEmpty/nested']],
]) {
  test(`failing test parser reads ${format}`, () => {
    assert.deepStrictEqual(require('../lib/failing-tests').parseFailingTests(log), expected);
  });
}

test('failing test parser returns null for unreadable logs', () => {
  assert.strictEqual(require('../lib/failing-tests').parseFailingTests('something failed'), null);
});

for (const [label, log, baseline, blocks] of [
  ['new failures outside baseline block', 'not ok 1 - old\nnot ok 2 - new', ['old'], true],
  ['unnamed failures block', 'not ok 1 - old\n# fail 2', ['old'], true],
  ['only baseline failures warn', 'not ok 1 - old', ['old'], false],
  ['unreadable logs keep whole-check warning', 'unknown failure', ['old'], false],
  ['missing baseline keeps warning with a recording hint', 'not ok 1 - old', null, false],
]) {
  test(`allowed failures: ${label}`, () => {
    const cmd = `node -e "console.log(${JSON.stringify(log).replaceAll('"', '\\"')});process.exit(1)"`;
    const root = repo({ ...BASIC, checks: { unit: { cmd } } }, {
      'docs/decisions.md': '- 2026-11-25 · 기존 실패 허용: unit · 기준에서도 실패하는 검사 · 고쳐지면\n',
      ...(baseline ? { '.quality/baseline.json': JSON.stringify({ failingTests: { unit: baseline } }) } : {}),
    });
    write(root, 'src/a.js', '2');
    write(root, '.quality/tasks/work.md', DECLARED);
    const r = qh(root, ['check']);
    assert.strictEqual(r.status, blocks ? 1 : 0, r.stdout + r.stderr);
    const t = require('../lib/triage').triage({ ...statusJson(root), config: BASIC });
    assert.strictEqual(t.aiFix.length, blocks ? 1 : 0, JSON.stringify(t));
    if (blocks) {
      assert.match(t.aiFix[0], /new/);
      assert.match(require('../lib/triage').aiFixUser(t.aiFix[0], BASIC), /새로 실패/);
      assert.strictEqual(stopDecision(qh(root, ['hook', 'stop'], '{"stop_hook_active":true}')).decision, 'block');
      assert.strictEqual(qh(root, ['status', '--pr']).status, 1);
    } else {
      assert.strictEqual(t.warnings.length, 1);
      if (!baseline) assert.match(t.warnings[0].agent, /qh baseline/);
    }
  });
}

test('baseline records allowed failing tests without structure tools and preserves other baselines', () => {
  const root = repo(BASIC, {
    'docs/decisions.md': '- 2026-11-25 · 기존 실패 허용: unit · 기준에서도 실패하는 검사 · 고쳐지면\n',
    '.quality/baseline.json': JSON.stringify({ cycles: { existing: 1 } }),
  });
  write(root, '.quality/evidence/unit.json', JSON.stringify({ exit: 1, logPath: '.quality/evidence/unit.log' }));
  write(root, '.quality/evidence/unit.log', 'not ok 1 - old\n');
  const r = qh(root, ['baseline']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const baseline = JSON.parse(fs.readFileSync(path.join(root, '.quality/baseline.json'), 'utf8'));
  assert.deepStrictEqual(baseline, { cycles: { existing: 1 }, failingTests: { unit: ['old'] } });
  write(root, '.quality/evidence/unit.log', 'unreadable');
  qh(root, ['baseline']);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, '.quality/baseline.json'), 'utf8')).failingTests, { unit: ['old'] });
});

test('adding failing test names to a baseline reaches criteria review', () => {
  const root = repo(BASIC, { '.quality/baseline.json': JSON.stringify({ failingTests: { unit: ['old'] } }) });
  write(root, '.quality/baseline.json', JSON.stringify({ failingTests: { unit: ['old', 'new'] } }));
  assert.match(repoTools.baselineChanges(root, 'main').join('\n'), /unit.*new/);
});

for (const state of ['missing', 'unreadable', 'passing']) {
  test(`baseline preserves committed failures with ${state} evidence per check`, () => {
    const root = repo(BASIC, {
      'docs/decisions.md': '- 2026-11-25 · 기존 실패 허용: a · 기준에서도 실패하는 검사 · 고쳐지면\n- 2026-11-25 · 기존 실패 허용: b · 기준에서도 실패하는 검사 · 고쳐지면\n',
      '.quality/baseline.json': JSON.stringify({ failingTests: { a: ['x'], b: ['y'] } }),
    });
    write(root, '.quality/evidence/a.json', JSON.stringify({ exit: 1, logPath: '.quality/evidence/a.log' }));
    write(root, '.quality/evidence/a.log', 'not ok 1 - updated');
    if (state !== 'missing') {
      write(root, '.quality/evidence/b.json', state === 'unreadable' ? '{' : JSON.stringify({ exit: 0, logPath: '.quality/evidence/b.log' }));
      write(root, '.quality/evidence/b.log', 'not ok 1 - ignored');
    }
    const result = qh(root, ['baseline']);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.deepStrictEqual(repoTools.readBaseline(root).failingTests, { a: ['updated'], b: ['y'] });
  });
}

for (const [format, log] of [
  ['node TAP', 'not ok 1 - old\n# fail 2'],
  ['node spec', '✖ old (2ms)\nℹ fail 2'],
  ['Jest', '  ● Suite › old\nTests: 2 failed, 1 passed, 3 total'],
  ['pytest', 'FAILED test/a.py::test_old - error\n=== 2 failed, 1 passed in 0.2s ==='],
  ['node without names', '# fail 1'],
  ['Jest without names', 'Tests: 1 failed, 1 total'],
  ['pytest without names', '=== 1 failed in 0.2s ==='],
]) {
  test(`failure count exceeding parsed names blocks ${format}`, () => {
    const failures = require('../lib/failing-tests');
    const names = failures.parseFailingTests(log);
    assert.ok(names !== null && !Array.isArray(names), 'partial names need an unreadable marker');
    const root = repo(BASIC, {
      'docs/decisions.md': '- 2026-11-25 · 기존 실패 허용: unit · 기준에서도 실패하는 검사 · 고쳐지면\n',
      '.quality/baseline.json': JSON.stringify({ failingTests: { unit: ['old', 'Suite › old', 'test/a.py::test_old'] } }),
    });
    write(root, '.quality/evidence/unit.log', log);
    write(root, '.quality/evidence/unit.json', JSON.stringify({ exit: 1, logPath: '.quality/evidence/unit.log' }));
    const scope = failures.failureScope(root, 'unit', '.quality/evidence/unit.log');
    assert.deepStrictEqual(scope.newFailures, ['(unnamed failures)']);
    assert.strictEqual(failures.isAllowedFailure({ name: 'unit', state: '실패', ...scope }, ['unit']), false);
    assert.deepStrictEqual(failures.baselineFailures(root), {});
    fs.unlinkSync(path.join(root, '.quality/baseline.json'));
    assert.deepStrictEqual(failures.failureScope(root, 'unit', '.quality/evidence/unit.log').newFailures, []);
  });
}

for (const log of ['not ok 1 - old\n# fail 1', '✖ old (2ms)\nℹ fail 1', '  ● Suite › old\nTests: 1 failed, 1 total', 'FAILED test/a.py::test_old - error\n=== 1 failed in 0.2s ===']) {
  test(`matching failure count keeps readable names: ${log.split('\n').at(-1)}`, () => {
    assert.strictEqual(require('../lib/failing-tests').parseFailingTests(log).length, 1);
  });
}

for (const [format, log, expected] of [
  ['Jest suite', 'FAIL test/new.js\n  ● Test suite failed to run\n  ● Suite › old', 'test/new.js › Test suite failed to run'],
  ['pytest collection', 'FAILED test/a.py::test_old - error\nERROR test/new.py - ImportError', 'ERROR test/new.py'],
  ['go build', '--- FAIL: TestOld (0.00s)\nFAIL\tpkg/new [build failed]', 'pkg/new [build failed]'],
  ['go setup', '--- FAIL: TestOld (0.00s)\nFAIL\tpkg/new [setup failed]', 'pkg/new [setup failed]'],
]) {
  test(`new ${format} failure is compared with the baseline`, () => {
    const failures = require('../lib/failing-tests');
    const root = repo(BASIC, {
      '.quality/baseline.json': JSON.stringify({ failingTests: { unit: ['Suite › old', 'test/a.py::test_old', 'TestOld'] } }),
    });
    write(root, '.quality/evidence/unit.log', log);
    assert.deepStrictEqual(failures.failureScope(root, 'unit', '.quality/evidence/unit.log').newFailures, [expected]);
    write(root, '.quality/baseline.json', JSON.stringify({ failingTests: { unit: failures.parseFailingTests(log) } }));
    assert.deepStrictEqual(failures.failureScope(root, 'unit', '.quality/evidence/unit.log').newFailures, []);
  });
}

test('baseline reports failing test counts per allowed check without an empty tool list', () => {
  const root = repo(BASIC, {
    'docs/decisions.md': '- 2026-11-25 · 기존 실패 허용: unit · 기준에서도 실패하는 검사 · 고쳐지면\n- 2026-11-25 · 기존 실패 허용: other · 기준에서도 실패하는 검사 · 고쳐지면\n',
  });
  for (const name of ['unit', 'other']) {
    write(root, `.quality/evidence/${name}.json`, JSON.stringify({ exit: 1, logPath: `.quality/evidence/${name}.log` }));
    write(root, `.quality/evidence/${name}.log`, name === 'unit' ? 'not ok 1 - a\nnot ok 2 - b\nnot ok 3 - c' : 'not ok 1 - d');
  }
  const result = qh(root, ['baseline']);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /기존 실패 unit 3건/);
  assert.match(result.stdout, /기존 실패 other 1건/);
  assert.doesNotMatch(result.stdout, /: 을|기록할 것이 없다/);
  fs.unlinkSync(path.join(root, '.quality/evidence/unit.json'));
  fs.unlinkSync(path.join(root, '.quality/evidence/other.json'));
  const unchanged = qh(root, ['baseline']);
  assert.strictEqual(unchanged.status, 0, unchanged.stdout + unchanged.stderr);
  assert.match(unchanged.stdout, /갱신할 항목 없음/);
  assert.doesNotMatch(unchanged.stdout, /: 을|기록할 것이 없다/);
});

test('a "N failed" phrase outside a summary line is not a failure count', () => {
  const names = require('../lib/failing-tests').parseFailingTests('✖ old (2ms)\n  retry: 3 failed attempts logged\nℹ fail 1');
  assert.deepStrictEqual(names, ['old']);
});

test('the same failing test name in two files is counted twice against the failure count', () => {
  const names = require('../lib/failing-tests').parseFailingTests('FAIL a.test.js\n  ● Suite › works\nFAIL b.test.js\n  ● Suite › works\nTests: 2 failed, 2 total');
  assert.deepStrictEqual(names, ['Suite › works']);
});
