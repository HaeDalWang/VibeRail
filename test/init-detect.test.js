'use strict';

// What init finds to run the tests with, outside a single Node package.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sh, write, qh } = require('./helpers');

function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-detect-'));
  sh(root, 'git', ['init', '-q', '-b', 'main']);
  sh(root, 'git', ['config', 'user.email', 't@example.invalid']);
  sh(root, 'git', ['config', 'user.name', 't']);
  for (const [rel, body] of Object.entries(files)) write(root, rel, body);
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'init']);
  return root;
}

const initConfig = (files) => {
  const root = project(files);
  const r = qh(root, ['init', root]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  return { out: r.stdout, config: JSON.parse(fs.readFileSync(path.join(root, '.quality/config.json'), 'utf8')) };
};

test('init drafts a pytest check for a pytest project', () => {
  const { config } = initConfig({ 'pyproject.toml': '[project]\nname = "app"\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n', 'tests/test_calc.py': 'def test_x(): pass\n' });
  assert.deepStrictEqual(config.checks.test, { cmd: 'pytest -q', on: ['pr'] });
});

test('init drafts go test for a Go module', () => {
  const { config } = initConfig({ 'go.mod': 'module example.com/app\n\ngo 1.22\n', 'calc_test.go': 'package app\n' });
  assert.strictEqual(config.checks.test.cmd, 'go test ./...');
});

test('init drafts the test scripts of packages one folder down', () => {
  const { config } = initConfig({
    'backend/package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
    'frontend/package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
    'web/package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
  });
  assert.strictEqual(config.checks.test.cmd, 'npm --prefix backend test && npm --prefix web test');
});

test('a single Node package still gets plain npm test', () => {
  const { config } = initConfig({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }), 'sub/package.json': JSON.stringify({ scripts: { test: 'x' } }) });
  assert.strictEqual(config.checks.test.cmd, 'npm test');
});

test('init says so when it finds no way to run the tests', () => {
  const { out, config } = initConfig({ 'README.md': '# app\n' });
  assert.strictEqual(config.checks.test, undefined);
  assert.match(out, /테스트 검사가 없다/);
});

test('the next step after install says in plain words what to tell the agent', () => {
  const { out } = initConfig({ 'package.json': '{"scripts":{"test":"node --test"}}\n' });
  assert.doesNotMatch(out, /qh 질문 세션/);
  assert.match(out, /에이전트에게 "품질 기준을 같이 정하자"라고 말한다/);
});
