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

test('init drafts cargo test for a Rust crate', () => {
  const { config } = initConfig({ 'Cargo.toml': '[package]\nname = "app"\nversion = "0.1.0"\n', 'src/lib.rs': 'pub fn one() -> i32 { 1 }\n' });
  assert.deepStrictEqual(config.checks.test, { cmd: 'cargo test', on: ['pr'] });
});

test('init drafts cargo test for every member of a Rust workspace', () => {
  const { config } = initConfig({ 'Cargo.toml': '[workspace]\nmembers = ["cli", "core"]\n', 'cli/Cargo.toml': '[package]\nname = "cli"\n' });
  assert.strictEqual(config.checks.test.cmd, 'cargo test --workspace');
});

test('init does not look for a Rust crate one folder down', () => {
  const { config } = initConfig({ 'tool/Cargo.toml': '[package]\nname = "tool"\n' });
  assert.ok(!config.checks.test || !/cargo/.test(config.checks.test.cmd));
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

// ---------- AI review command (Kiro first, else Claude Code headless) ----------

const { draftConfig } = require('../lib/init');
const { spawnSync } = require('node:child_process');
const { QH, TEST_ENV, repo, DECLARED, BASIC } = require('./helpers');
const reviewOf = (d) => JSON.parse(draftConfig({ baseRef: 'main', ...d })).review;

test('init fills a read-only Claude Code review command when kiro-run is absent but claude is there', () => {
  assert.strictEqual(reviewOf({ hasKiroRun: false, hasClaude: false }), undefined);
  assert.match(reviewOf({ hasKiroRun: true, hasClaude: true }).cmd, /^kiro-run \{workdir\} \{task\}/, 'Kiro stays first');
  const { cmd } = reviewOf({ hasKiroRun: false, hasClaude: true });
  assert.match(cmd, /^claude -p "\$\(cat \{task\}\)"/);
  assert.match(cmd, / --tools Read,Grep,Glob /, 'no tool that edits files or runs commands');
  assert.doesNotMatch(cmd, /bypassPermissions|acceptEdits|Edit|Write|Bash/);
  assert.match(cmd, / --settings '\{"disableAllHooks":true\}' /, 'the reviewer session must not run this project\'s hooks (a Stop hook rewrote its answer, 2026-11-27)');
  assert.match(cmd, /> \{out\}\/result\.json$/);
});

test('the Claude Code review command turns the structured answer into result.json', () => {
  const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-claude-'));
  const finding = { file: 'src/a.js', line: 1, rank: 1, severity: '중간', verdict: 'confirmed', checklist: '6', reason: '값이 바뀜', nextAction: '확인' };
  fs.writeFileSync(path.join(stub, 'claude'), `#!/bin/sh\necho '${JSON.stringify({ type: 'result', structured_output: { findings: [finding] } })}'\n`, { mode: 0o755 });
  const root = repo({ ...BASIC, review: reviewOf({ hasKiroRun: false, hasClaude: true }) });
  write(root, 'src/a.js', '2');
  write(root, '.quality/tasks/work.md', DECLARED);
  const r = spawnSync(process.execPath, [QH, 'review'], { cwd: root, encoding: 'utf8', env: { ...TEST_ENV, PATH: `${stub}:${TEST_ENV.PATH}` } });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, '.quality/evidence/review/result.json'), 'utf8')), [finding]);
});

test('init and the question screen see a login server and DB in a package one folder down', () => {
  const pkg = JSON.stringify({ dependencies: { express: '^5', pg: '^8', passport: '^0.7' } });
  const { out, config } = initConfig({ 'backend/package.json': pkg, 'backend/src/app.js': '1\n', 'frontend/package.json': '{}' });
  assert.match(out, /express=예, DB=postgres/);
  assert.ok(config.checks.access, 'route check drafted');
  const rec = require('../lib/questions').recommend(project({ 'backend/package.json': pkg }));
  assert.strictEqual(rec.login[0], 'A');
  assert.strictEqual(rec.db[0], 'A');
});

test('init suggests node --test for a Node project without configuring a test check', () => {
  for (const pkg of [{}, { scripts: { test: 'echo "Error: no test specified" && exit 1' } }]) {
    const { out, config } = initConfig({ 'package.json': JSON.stringify(pkg) });
    assert.match(out, /Node 내장 테스트/);
    assert.match(out, /node --test/);
    assert.strictEqual(config.checks.test, undefined);
  }
  assert.doesNotMatch(initConfig({ 'README.md': '# app\n' }).out, /node --test/);
});
