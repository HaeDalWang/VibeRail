'use strict';

// `qh uninstall` takes out what `qh init` added and leaves the person's own content.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sh, write, qh } = require('./helpers');

function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-uninstall-'));
  sh(root, 'git', ['init', '-q', '-b', 'main']);
  sh(root, 'git', ['config', 'user.email', 't@example.invalid']);
  sh(root, 'git', ['config', 'user.name', 't']);
  for (const [rel, body] of Object.entries(files)) write(root, rel, body);
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'start']);
  return root;
}

const exists = (root, rel) => fs.existsSync(path.join(root, rel));
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function commitAll(root, msg) {
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', msg]);
}

const MINE = {
  'AGENTS.md': '# My rules\n\nBe kind.\n',
  'CLAUDE.md': '@AGENTS.md\n\nMy note.\n',
  '.gitignore': 'node_modules/\n',
  '.claude/settings.json': `${JSON.stringify({ model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }, null, 2)}\n`,
  'package.json': '{"name":"p"}\n',
};

test('uninstall removes what init added and keeps the person\'s own content', () => {
  const root = project(MINE);
  assert.strictEqual(qh(root, ['init', root]).status, 0);
  commitAll(root, 'chore: qh 설치');
  const r = qh(root, ['uninstall']);
  assert.strictEqual(r.status, 0, r.stdout);
  for (const gone of ['.quality/qh', '.quality/evidence', '.kiro/hooks/qh.json', '.claude/skills/qh-cycle', '.claude/skills/mattpocock-skills.LICENSE', 'docs/agents/issue-tracker.md']) {
    assert.ok(!exists(root, gone), `${gone} should be gone`);
  }
  assert.strictEqual(read(root, 'AGENTS.md'), '# My rules\n\nBe kind.\n');
  assert.strictEqual(read(root, 'CLAUDE.md'), '@AGENTS.md\n\nMy note.\n');
  assert.strictEqual(read(root, '.gitignore'), 'node_modules/\n');
  const settings = JSON.parse(read(root, '.claude/settings.json'));
  assert.deepStrictEqual(settings, JSON.parse(MINE['.claude/settings.json']), 'only the person\'s hook is left');
  assert.ok(exists(root, '.quality/config.json'), 'the person\'s criteria stay');
  assert.match(r.stdout, /code-review-graph uninstall/, 'the code map has its own uninstall: one step is printed');
});

test('uninstall removes the files init created from nothing, and is safe to run twice', () => {
  const root = project({ 'package.json': '{"name":"p"}\n' });
  assert.strictEqual(qh(root, ['init', root]).status, 0);
  commitAll(root, 'chore: qh 설치');
  assert.strictEqual(qh(root, ['uninstall']).status, 0);
  for (const gone of ['AGENTS.md', 'CLAUDE.md', '.claude/settings.json', '.gitignore']) assert.ok(!exists(root, gone), `${gone} was created by init`);
  assert.strictEqual(qh(root, ['uninstall']).status, 0);
});

test('uninstall run from the installed copy can delete the copy it runs from', () => {
  const root = project({ 'package.json': '{"name":"p"}\n' });
  qh(root, ['init', root]);
  commitAll(root, 'chore: qh 설치');
  const r = require('node:child_process').spawnSync(process.execPath, [path.join(root, '.quality/qh/bin/qh.js'), 'uninstall'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(!exists(root, '.quality/qh'));
});

test('uninstall stops when a file it would edit has uncommitted changes', () => {
  const root = project(MINE);
  qh(root, ['init', root]);
  commitAll(root, 'chore: qh 설치');
  write(root, 'AGENTS.md', `${read(root, 'AGENTS.md')}\nmy unsaved line\n`);
  const r = qh(root, ['uninstall']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /AGENTS\.md/);
  assert.ok(exists(root, '.quality/qh'), 'nothing was removed');
});
