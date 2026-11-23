'use strict';

// What init keeps out of the person's git status, and what it tells about the code map's side effects.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { repo, qh, sh, BASIC } = require('./helpers');

const ROOT = path.join(__dirname, '..');

test('init gitignores the machine-specific map settings, reports and measurements, and says what the code map added', () => {
  const root = repo(BASIC);
  const r = qh(root, ['init', root]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const ignored = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n');
  for (const line of ['.quality/evidence/', '.mcp.json', '.kiro/settings/mcp.json', '.quality/reports/', '.quality/metrics.csv']) assert.ok(ignored.includes(line), line);
  const status = sh(root, 'git', ['status', '--porcelain', '--untracked-files=all']);
  assert.doesNotMatch(status, /\.mcp\.json/);
  assert.match(r.stdout, /코드 지도가 더한 것[\s\S]*pre-commit[\s\S]*\.mcp\.json[\s\S]*\.claude\/skills/);
  const again = qh(root, ['init', root]);
  assert.strictEqual(fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n').filter((l) => l === '.mcp.json').length, 1, again.stdout);
});

test('INSTALL.md does not tell the agent to commit the map settings that hold an absolute path', () => {
  const install = fs.readFileSync(path.join(ROOT, 'INSTALL.md'), 'utf8');
  assert.doesNotMatch(install, /코드 지도가 만든 `\.mcp\.json`/);
  assert.match(install, /\.mcp\.json[^\n]*커밋하지 않/);
});
