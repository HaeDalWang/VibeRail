'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const QH = path.join(__dirname, '..', 'bin', 'qh.js');

// A stand-in code map on PATH: logs its arguments, and builds/installs like the real one
// would (an index file, an .mcp.json entry for the current folder).
const MAP_STUB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-map-'));
const MAP_LOG = path.join(MAP_STUB_DIR, 'calls.log');
fs.writeFileSync(path.join(MAP_STUB_DIR, 'code-review-graph'), `#!/bin/sh
echo "$@" >> "${MAP_LOG}"
case "$1" in
  build) mkdir -p .code-review-graph && : > .code-review-graph/graph.db ;;
  install) printf '{"mcpServers":{"code-review-graph":{"cwd":"%s"}}}' "$PWD" > .mcp.json ;;
esac
`, { mode: 0o755 });
const TEST_ENV = { ...process.env, PATH: `${MAP_STUB_DIR}:${process.env.PATH}` };

function sh(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function repo(config, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-core-'));
  sh(root, 'git', ['init', '-q', '-b', 'main']);
  sh(root, 'git', ['config', 'user.email', 't@example.invalid']);
  sh(root, 'git', ['config', 'user.name', 't']);
  write(root, '.quality/config.json', JSON.stringify(config));
  write(root, 'src/a.js', '1');
  for (const [rel, body] of Object.entries(files)) write(root, rel, body);
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'init']);
  sh(root, 'git', ['checkout', '-qb', 'work']);
  return root;
}

function write(root, rel, body) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
}

function qh(root, args, input) {
  return spawnSync(process.execPath, [QH, ...args], { cwd: root, encoding: 'utf8', input, env: TEST_ENV });
}

function statusJson(root) {
  const r = qh(root, ['status', '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

// Stop blocks with exit 0 + {"decision":"block"} on stdout: Claude Code documents it,
// and Kiro Stop hooks in practice rely on it (non-zero exits only warn the user there).
function stopDecision(r) {
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

const stateOf = (s, name) => s.checks.find((c) => c.name === name)?.state;

// Always-on rules want tests and docs with every code change, or a reason in the card.
const DECLARED = '테스트 불필요: 상수 하나만 바꿈\n문서 영향 없음: 사용자에게 안 보임\n';

const BASIC = {
  baseRef: 'main',
  checks: { unit: { cmd: 'node -e "process.exit(0)"' } },
  common: ['unit'],
};

module.exports = { QH, MAP_LOG, TEST_ENV, sh, repo, write, qh, statusJson, stopDecision, stateOf, DECLARED, BASIC };
