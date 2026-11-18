'use strict';

// `qh uninstall`: take out what `qh init` added, leave what is the person's. Removed: qh's copy
// (.quality/qh), the evidence cache, the Claude/Kiro hook entries, the rule block in AGENTS.md,
// the skills init copied (qh's files, overwritten on every init), the agent docs while still unchanged, the .gitignore line, and any
// file init created from nothing. Kept: config, access table, probe, task cards, decision log,
// measurements. The code map is another tool's: its own uninstall is printed, not run.
// Everything is required up front: the running copy may be the folder this deletes.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { INSTALL_DIR, MARK_START, MARK_END, QH_HOOK } = require('./init');
const { shippedSkills, SKILLS_DIR } = require('./skills-install');
const { MAP_TOOL } = require('./doctor');

const VENDOR_DOCS = 'skills/vendor/mattpocock-skills/agents-docs';
const AGENT_DOCS = [['issue-tracker-local.md', 'docs/agents/issue-tracker.md'], ['triage-labels.md', 'docs/agents/triage-labels.md'], ['domain.md', 'docs/agents/domain.md']];
const EVIDENCE_LINE = '.quality/evidence/';

const read = (root, rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : null);
const remove = (root, rel) => fs.rmSync(path.join(root, rel), { recursive: true, force: true });
const isGit = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();

// Writes `text`, or deletes the file when nothing is left of it.
function rewrite(root, rel, text) {
  if (text.trim() === '') remove(root, rel);
  else fs.writeFileSync(path.join(root, rel), text);
}

function stripRuleBlock(root) {
  const agents = read(root, 'AGENTS.md');
  const pattern = new RegExp(`\\n*${MARK_START}[\\s\\S]*?${MARK_END}\\n?`);
  if (agents === null || !pattern.test(agents)) return [];
  const rest = agents.replace(pattern, '\n\n').replace(/^\n+/, '').replace(/\n+$/, (m) => (m ? '\n' : ''));
  rewrite(root, 'AGENTS.md', rest);
  // CLAUDE.md that only points at the AGENTS.md init made goes with it.
  if (rest.trim() === '' && read(root, 'CLAUDE.md')?.trim() === '@AGENTS.md') remove(root, 'CLAUDE.md');
  return ['AGENTS.md의 qh 규칙 블록'];
}

function stripClaudeHooks(root) {
  const rel = '.claude/settings.json';
  const text = read(root, rel);
  if (text === null) return [];
  const settings = JSON.parse(text);
  const before = JSON.stringify(settings.hooks || {});
  for (const [event, entries] of Object.entries(settings.hooks || {})) {
    const isOurs = (x) => QH_HOOK.test(String(x.command));
    const kept = entries.flatMap((e) => {
      if (!(e.hooks || []).some(isOurs)) return [e];
      const rest = e.hooks.filter((x) => !isOurs(x));
      return rest.length ? [{ ...e, hooks: rest }] : [];
    });
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
  if (JSON.stringify(settings.hooks || {}) === before) return [];
  rewrite(root, rel, Object.keys(settings).length ? `${JSON.stringify(settings, null, 2)}\n` : '');
  return ['.claude/settings.json의 qh hook'];
}

function stripGitignore(root) {
  const text = read(root, '.gitignore');
  if (text === null || !text.split('\n').some((l) => l.trim() === EVIDENCE_LINE)) return [];
  rewrite(root, '.gitignore', text.split('\n').filter((l) => l.trim() !== EVIDENCE_LINE).join('\n'));
  return ['.gitignore의 증거 폴더 줄'];
}

// What init copied from qh, removed only while it still equals the shipped file.
function stripCopies(root, qhHome) {
  const out = [];
  for (const { name } of shippedSkills(qhHome)) {
    if (fs.existsSync(path.join(root, SKILLS_DIR, name))) {
      remove(root, path.join(SKILLS_DIR, name));
      out.push(`${SKILLS_DIR}/${name}`);
    }
  }
  const license = `${SKILLS_DIR}/mattpocock-skills.LICENSE`;
  if (read(root, license) !== null) { remove(root, license); out.push(license); }
  for (const [from, to] of AGENT_DOCS) {
    const shipped = read(qhHome, path.join(VENDOR_DOCS, from));
    if (shipped !== null && read(root, to) === shipped) { remove(root, to); out.push(to); }
  }
  if (read(root, '.scratch/.gitkeep') === '') { remove(root, '.scratch/.gitkeep'); out.push('.scratch/.gitkeep'); }
  for (const dir of ['.claude/skills', '.claude', 'docs/agents', '.scratch']) {
    const full = path.join(root, dir);
    if (fs.existsSync(full) && !fs.readdirSync(full).length) fs.rmdirSync(full);
  }
  return out;
}

function uninstall(qhHome, root) {
  // Only files that still carry something of qh's are edited, and only when their edits are saved.
  const carries = { 'AGENTS.md': MARK_START, '.gitignore': EVIDENCE_LINE, '.claude/settings.json': 'qh.js' };
  const touched = Object.entries(carries).filter(([f, mark]) => read(root, f)?.includes(mark) && isGit(root, ['status', '--porcelain', '--', f])).map(([f]) => f);
  if (touched.length) {
    console.log(`커밋 안 된 변경이 있는 파일을 고쳐야 해서 멈춤 (되돌릴 수 없다): ${touched.join(', ')}\n먼저 커밋하거나 치운 뒤 다시 실행.`);
    return 1;
  }
  const removed = [
    ...stripRuleBlock(root),
    ...stripClaudeHooks(root),
    ...stripGitignore(root),
    ...stripCopies(root, qhHome),
  ];
  for (const rel of [INSTALL_DIR, '.quality/evidence', '.kiro/hooks/qh.json']) {
    if (fs.existsSync(path.join(root, rel))) { remove(root, rel); removed.push(rel); }
  }
  for (const dir of ['.kiro/hooks', '.kiro']) {
    const full = path.join(root, dir);
    if (fs.existsSync(full) && !fs.readdirSync(full).length) fs.rmdirSync(full);
  }
  console.log(removed.length ? `qh uninstall: 지움·되돌림\n${removed.map((r) => `  - ${r}`).join('\n')}` : 'qh uninstall: 지울 것이 없다 (이미 지워졌다)');
  console.log('남겨 둠 (직접 판단): .quality/config.json·access.json·probe.mjs·tasks·metrics.csv·reports, docs/decisions.md');
  console.log(`코드 지도(${MAP_TOOL})는 따로 지운다: \`${MAP_TOOL} uninstall --repo . --keep-user-configs -y\``);
  console.log('되돌리려면: 고쳐진 파일은 `git checkout -- <파일>`, 지워진 설치본은 `node <VibeRail 폴더>/bin/qh.js init .`');
  return 0;
}

module.exports = { uninstall };
