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
// The gitignore lines that still protect a file after uninstall (the code map's settings, when it is installed).
const { IGNORED } = require('../lib/init');
const stillProtected = (root) => IGNORED.filter((l) => exists(root, l)).map((l) => `${l}\n`).join('');
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
  assert.strictEqual(read(root, '.gitignore'), `node_modules/\n${stillProtected(root)}`);
  const settings = JSON.parse(read(root, '.claude/settings.json'));
  assert.deepStrictEqual(settings, JSON.parse(MINE['.claude/settings.json']), 'only the person\'s hook is left');
  assert.ok(exists(root, '.quality/config.json'), 'the person\'s criteria stay');
  assert.match(r.stdout, /code-review-graph uninstall/, 'the code map has its own uninstall: one step is printed');
});

test('uninstall keeps the gitignore lines of files it leaves behind (map settings, word list, measurements)', () => {
  const root = project(MINE);
  assert.strictEqual(qh(root, ['init', root]).status, 0);
  commitAll(root, 'chore: qh 설치');
  for (const rel of ['.mcp.json', '.kiro/settings/mcp.json', '.quality/me.md', '.quality/metrics.csv', '.quality/reports/a.html']) write(root, rel, 'x\n');
  assert.strictEqual(qh(root, ['uninstall']).status, 0);
  const lines = read(root, '.gitignore').split('\n');
  for (const kept of ['.mcp.json', '.kiro/settings/mcp.json', '.quality/me.md', '.quality/metrics.csv', '.quality/reports/']) assert.ok(lines.includes(kept), `${kept} still protects a file that stays`);
  assert.ok(!lines.includes('.quality/evidence/'), 'the evidence cache is deleted, so its line goes');
});

test('uninstall removes the files init created from nothing, and is safe to run twice', () => {
  const root = project({ 'package.json': '{"name":"p"}\n' });
  assert.strictEqual(qh(root, ['init', root]).status, 0);
  commitAll(root, 'chore: qh 설치');
  assert.strictEqual(qh(root, ['uninstall']).status, 0);
  for (const gone of ['AGENTS.md', 'CLAUDE.md', '.claude/settings.json']) assert.ok(!exists(root, gone), `${gone} was created by init`);
  const left = stillProtected(root);
  if (left) assert.strictEqual(read(root, '.gitignore'), left);
  else assert.ok(!exists(root, '.gitignore'), '.gitignore was created by init');
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

test('uninstall keeps a skill folder the person changed and lists it, and removes an unchanged one', () => {
  const root = project(MINE);
  qh(root, ['init', root]);
  commitAll(root, 'chore: qh 설치');
  write(root, '.claude/skills/qh-cycle/SKILL.md', `${read(root, '.claude/skills/qh-cycle/SKILL.md')}\nmy own step\n`);
  write(root, '.claude/skills/tdd/my-notes.md', 'mine');
  const r = qh(root, ['uninstall']);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.ok(exists(root, '.claude/skills/qh-cycle/SKILL.md'), 'edited skill kept');
  assert.ok(exists(root, '.claude/skills/tdd/my-notes.md'), 'a file added to a skill folder is kept');
  assert.match(r.stdout, /남겨 둠 \(설치본과 달라져[^\n]*qh-cycle[^\n]*tdd|남겨 둠 \(설치본과 달라져[^\n]*tdd[^\n]*qh-cycle/);
  assert.ok(!exists(root, '.claude/skills/grilling'), 'an unchanged skill goes');
});

test('uninstall changes nothing when .claude/settings.json is malformed or its hooks have the wrong shape', () => {
  for (const bad of ['{ not json qh.js', '{"hooks":{"Stop":"qh.js"}}']) {
    const root = project(MINE);
    qh(root, ['init', root]);
    commitAll(root, 'chore: qh 설치');
    write(root, '.claude/settings.json', bad);
    commitAll(root, 'break settings');
    const agents = read(root, 'AGENTS.md');
    const r = qh(root, ['uninstall']);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.match(r.stdout, /환경 오류[^\n]*\.claude\/settings\.json/);
    assert.match(r.stdout, /아무것도 바꾸지 않았다/);
    assert.strictEqual(read(root, 'AGENTS.md'), agents, 'AGENTS.md untouched');
    assert.ok(exists(root, '.quality/qh') && exists(root, '.claude/skills/qh-cycle'), 'nothing was removed');
  }
});
