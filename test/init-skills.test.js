'use strict';

// `qh init` installs the vendored Pocock skills and qh-cycle into the project's
// .claude/skills/, byte for byte, plus the agent docs the skills read.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sh, write, qh } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const VENDOR = path.join(ROOT, 'skills/vendor/mattpocock-skills');
const SKILLS = ['grill-with-docs', 'domain-modeling', 'codebase-design', 'improve-codebase-architecture', 'tdd', 'to-spec', 'to-tickets', 'retro', 'grilling', 'writing-for-agents'];
const NOT_INSTALLED = ['implement', 'code-review', 'setup-matt-pocock-skills'];

test('the installed agent rules and the report take the minimum reason length and duplicate size from limits', () => {
  const root = project();
  write(root, '.quality/config.json', JSON.stringify({ baseRef: 'main', checks: {}, limits: { reasonChars: 8 } }));
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'config']);
  assert.strictEqual(qh(root, ['init', root]).status, 0);
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /<why no test is needed, 8\+ chars>/);
  assert.doesNotMatch(agents, /\{\{|5\+ chars/);
  const { LIMITS } = require('../lib/policy');
  const saved = LIMITS.duplicateLines;
  LIMITS.duplicateLines = 9;
  try {
    assert.match(require('../lib/measure-page').page('p', [], []), /의미 있는 9줄/);
  } finally {
    LIMITS.duplicateLines = saved;
  }
});

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-skills-'));
  sh(root, 'git', ['init', '-q', '-b', 'main']);
  sh(root, 'git', ['config', 'user.email', 't@example.invalid']);
  sh(root, 'git', ['config', 'user.name', 't']);
  write(root, 'package.json', JSON.stringify({ scripts: { test: 'node --test' } }));
  write(root, 'src/a.js', 'module.exports = 1;\n');
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'init']);
  return root;
}

// { relative path: Buffer } for every file under dir.
const filesOf = (dir) => Object.fromEntries(fs.globSync('**/*', { cwd: dir }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort().map((f) => [f, fs.readFileSync(path.join(dir, f))]));
function sameBytes(a, b) {
  assert.deepStrictEqual(Object.keys(a), Object.keys(b));
  for (const k of Object.keys(a)) assert.ok(a[k].equals(b[k]), `${k} differs`);
}

test('vendor records its source: repository, commit, license', () => {
  const [url, commit] = fs.readFileSync(path.join(VENDOR, 'UPSTREAM'), 'utf8').trim().split('\n');
  assert.match(url, /^https:\/\/github\.com\/mattpocock\/skills$/);
  assert.match(commit, /^5863806[0-9a-f]{33}$/);
  assert.match(fs.readFileSync(path.join(VENDOR, 'LICENSE'), 'utf8'), /MIT License/);
  for (const n of NOT_INSTALLED) assert.strictEqual(fs.existsSync(path.join(VENDOR, n)), false, `${n} is not vendored`);
});

test('init installs the 10 vendored skills and qh-cycle byte for byte, and nothing else of theirs', () => {
  const root = project();
  const r = qh(root, ['init', root]);
  assert.strictEqual(r.status, 0, r.stdout);
  for (const n of SKILLS) sameBytes(filesOf(path.join(root, '.claude/skills', n)), filesOf(path.join(VENDOR, n)));
  sameBytes(filesOf(path.join(root, '.claude/skills/qh-cycle')), filesOf(path.join(ROOT, 'skills/qh-cycle')));
  for (const n of NOT_INSTALLED) assert.strictEqual(fs.existsSync(path.join(root, '.claude/skills', n)), false);
  assert.strictEqual(fs.readFileSync(path.join(root, '.claude/skills/mattpocock-skills.LICENSE'), 'utf8'), fs.readFileSync(path.join(VENDOR, 'LICENSE'), 'utf8'));
  assert.match(r.stdout, /\.claude\/skills\/tdd\b/);
  assert.doesNotMatch(r.stdout, /\.claude\/skills\/tdd\/SKILL\.md/, 'one entry per skill, not per file');
});

test('init overwrites an installed skill (not a user file) and is quiet when nothing changed', () => {
  const root = project();
  qh(root, ['init', root]);
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'qh']);
  assert.match(qh(root, ['init', root]).stdout, /바뀐 것 없음/);
  write(root, '.claude/skills/tdd/SKILL.md', 'edited by hand');
  const r = qh(root, ['init', root]);
  assert.strictEqual(r.status, 0, r.stdout);
  sameBytes(filesOf(path.join(root, '.claude/skills/tdd')), filesOf(path.join(VENDOR, 'tdd')));
});

test('init run from a project copy of qh installs the same skills (the copy carries them)', () => {
  const first = project();
  qh(first, ['init', first]);
  const second = project();
  const r = require('node:child_process').spawnSync(process.execPath, [path.join(first, '.quality/qh/bin/qh.js'), 'init', second], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  for (const n of [...SKILLS, 'qh-cycle']) sameBytes(filesOf(path.join(second, '.claude/skills', n)), filesOf(path.join(first, '.claude/skills', n)));
  assert.ok(fs.existsSync(path.join(second, 'docs/agents/domain.md')));
});

test('init creates the agent docs and .scratch only when missing, and no GLOSSARY.md', () => {
  const root = project();
  write(root, 'docs/agents/domain.md', 'mine\n');
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'docs']);
  qh(root, ['init', root]);
  const docs = path.join(VENDOR, 'agents-docs');
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'docs/agents/issue-tracker.md')), fs.readFileSync(path.join(docs, 'issue-tracker-local.md')));
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'docs/agents/triage-labels.md')), fs.readFileSync(path.join(docs, 'triage-labels.md')));
  assert.strictEqual(fs.readFileSync(path.join(root, 'docs/agents/domain.md'), 'utf8'), 'mine\n', 'an existing file stays');
  assert.ok(fs.existsSync(path.join(root, '.scratch/.gitkeep')));
  assert.strictEqual(fs.existsSync(path.join(root, 'GLOSSARY.md')), false);
  write(root, 'docs/agents/triage-labels.md', 'edited\n');
  qh(root, ['init', root]);
  assert.strictEqual(fs.readFileSync(path.join(root, 'docs/agents/triage-labels.md'), 'utf8'), 'edited\n', 're-init leaves the person\'s edit');
});

test('a new config draft needs no duplicates setting (existing copies never block); an existing config is left alone', () => {
  const root = project();
  qh(root, ['init', root]);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, '.quality/config.json'), 'utf8')).structure?.duplicates, undefined);
  const old = project();
  write(old, '.quality/config.json', JSON.stringify({ baseRef: 'main', checks: {}, common: [] }));
  sh(old, 'git', ['add', '-A']);
  sh(old, 'git', ['commit', '-qm', 'cfg']);
  qh(old, ['init', old]);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(old, '.quality/config.json'), 'utf8')).structure, undefined);
});

test('qh-cycle tells the agent the interface JSON shape that qh view accepts, so it need not read qh code', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'skills/qh-cycle/SKILL.md'), 'utf8');
  for (const key of ['title', 'options', 'id', 'name', 'summary', 'mermaid', 'gain', 'cost']) assert.match(skill, new RegExp(`\\b${key}\\b`), key);
});

test('qh-cycle tells the agent the optional questions shape on both decision pages', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'skills/qh-cycle/SKILL.md'), 'utf8');
  for (const shape of ['"options"', '"candidates"']) {
    const line = skill.split('\n').find((l) => l.includes(shape));
    for (const key of ['questions', 'text', 'choices', 'recommended']) assert.match(line, new RegExp(`\\b${key}\\b`), `${shape}: ${key}`);
  }
});

test('qh-cycle ◆③ tells the agent to open the review page qh review writes', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'skills/qh-cycle/SKILL.md'), 'utf8');
  const row = skill.split('\n').find((l) => l.startsWith('| ◆③'));
  assert.match(row, /review page/);
  assert.match(row, /open/);
});
