'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { repo, write, qh, sh } = require('./helpers');
const { measure } = require('../lib/measure');

const config = { baseRef: 'main', checks: { test: { cmd: 'env -u NODE_TEST_CONTEXT node --test test/seam.test.js', on: ['pr'] } }, common: ['test'] };
function project(t, cmd = config.checks.test.cmd) {
  const root = repo({ ...config, checks: { test: { cmd, on: ['pr'] } } }, {
    'package.json': '{"scripts":{"test":"node --test test/seam.test.js"}}',
    '.gitignore': '.quality/evidence/\n',
    'src/a.js': "exports.run = () => require('./internal').run();\n",
    'src/internal.js': 'exports.run = () => 42;\n',
    'src/idle.js': 'exports.run = () => 0;\n',
    'scripts/setup.sh': 'echo hi\n',
    'test/seam.test.js': "require('../src/idle'); require('node:assert/strict').equal(require('../src/a').run(), 42); require('node:fs').appendFileSync('.quality/evidence/runs.log', 'run\\n');\n",
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.quality/evidence'), { recursive: true });
  return root;
}

test('coverage counts indirect function execution, not module loading', (t) => {
  const root = project(t);
  assert.equal(measure(root).now.untested_pct, 33.3, 'scripts/setup.sh leaves no V8 record and is not counted');
  write(root, 'docs/decisions.md', '- 테스트 없음 허용: src/idle.js\n');
  assert.equal(measure(root).now.untested_pct, 33.3);
  write(root, 'docs/decisions.md', '- 테스트 없음 허용: src/idle.js · 상수 성격이라 제외한다\n');
  assert.equal(measure(root).now.untested_pct, 0);
});

test('coverage reuses full check evidence only for the same tree', (t) => {
  const root = project(t);
  assert.equal(qh(root, ['check', 'test', '--pr']).status, 0);
  assert.equal(measure(root).now.untested_pct, 33.3);
  measure(root);
  const runs = () => fs.readFileSync(path.join(root, '.quality/evidence/runs.log'), 'utf8').trim().split('\n').length;
  assert.equal(runs(), 1);
  write(root, 'src/idle.js', 'exports.run = () => 1;\n');
  measure(root);
  assert.equal(runs(), 2);
});

test('coverage is unavailable without usable Node test execution', (t) => {
  for (const cmd of ['printf empty', 'node --test --help', 'node --test missing.test.js', 'pytest -q']) {
    const root = project(t, cmd);
    assert.equal(measure(root).now.untested_pct, null, cmd);
  }
  const root = project(t);
  write(root, '.quality/config.json', JSON.stringify({ baseRef: 'main', checks: {} }));
  write(root, 'package.json', '{}');
  assert.equal(measure(root).now.untested_pct, null);
});

test('backfill coverage is unavailable and never runs historical tests', (t) => {
  const root = project(t);
  const sha = sh(root, 'git', ['rev-parse', 'HEAD']);
  // The commit before installation is always included by backfill.
  write(root, '.quality/qh/bin/qh.js', '// installed\n');
  sh(root, 'git', ['add', '.quality/qh/bin/qh.js']);
  sh(root, 'git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'install']);
  assert.equal(measure(root, { weeks: 1 }).now.untested_pct, 33.3);
  const csv = fs.readFileSync(path.join(root, '.quality/metrics.csv'), 'utf8').trim().split('\n').map((l) => l.split(','));
  const head = csv.shift();
  const past = csv.find((r) => r[head.indexOf('backfill')] === '1' && sha.startsWith(r[head.indexOf('sha')]));
  assert.ok(past);
  assert.equal(past[head.indexOf('untested_pct')], '');
});

test('coverage errors stay unavailable and preserve the test result', (t) => {
  const root = project(t);
  const { run } = require('../lib/coverage');
  const result = { status: 0, stdout: 'passed' };
  assert.equal(run(root, config.checks.test, 'tree', () => 'tree', (env) => {
    fs.writeFileSync(path.join(env.NODE_V8_COVERAGE, 'broken.json'), '{');
    return result;
  }), result);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.quality/evidence/coverage.json'))).executed, null);
});

test('similar functions are optional reference numbers from the installed tool', (t) => {
  const root = project(t);
  assert.equal(measure(root).now.similar_functions, undefined);
  write(root, 'node_modules/.bin/jscpd', `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const out = process.argv[process.argv.indexOf('--output') + 1];
const file = (name) => ({ name: path.join(process.cwd(), 'src', name) });
fs.writeFileSync(path.join(out, 'jscpd-report.json'), JSON.stringify({ duplicates: [{ kind: 'similar', firstFile: file('a.js'), secondFile: file('internal.js') }] }));
`);
  fs.chmodSync(path.join(root, 'node_modules/.bin/jscpd'), 0o755);
  assert.equal(measure(root).now.similar_functions, 1);
});

test('coverage measures executed functions even when an assertion fails', (t) => {
  const root = project(t);
  write(root, 'test/seam.test.js', "require('../src/a').run(); throw new Error('assertion failed');\n");
  assert.equal(measure(root).now.untested_pct, 33.3);
  assert.notEqual(JSON.parse(fs.readFileSync(path.join(root, '.quality/evidence/coverage.json'))).exit, 0);
});


test('coverage accepts a Node test command without a specific test runner', (t) => {
  const root = project(t, 'env -u NODE_TEST_CONTEXT node test/seam.test.js');
  assert.equal(measure(root).now.untested_pct, 33.3);
});
