'use strict';

// `qh uninstall`: take out what `qh init` added, leave what is the person's. Removed: qh's copy
// (.quality/qh), the evidence cache, the Claude/Kiro hook entries, the rule block in AGENTS.md,
// the skills init copied while still unchanged, the agent docs while still unchanged, the .gitignore lines whose files are gone, and any
// file init created from nothing. Kept: config, access table, probe, task cards, decision log,
// measurements. The code map is another tool's: its own uninstall is printed, not run.
// Everything is required up front: the running copy may be the folder this deletes.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { INSTALL_DIR, MARK_START, MARK_END, QH_HOOK, IGNORED } = require('./init');
const { shippedSkills, isSkillUnchanged, SKILLS_DIR } = require('./skills-install');
const { MAP_TOOL } = require('./doctor');

const VENDOR_DOCS = 'skills/vendor/mattpocock-skills/agents-docs';
const AGENT_DOCS = [['issue-tracker-local.md', 'docs/agents/issue-tracker.md'], ['triage-labels.md', 'docs/agents/triage-labels.md'], ['domain.md', 'docs/agents/domain.md']];

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

const CLAUDE_SETTINGS = '.claude/settings.json';

// The parsed settings (null when absent), or an Error saying what is wrong: checked before anything is written.
function readClaudeSettings(root) {
  const text = read(root, CLAUDE_SETTINGS);
  if (text === null) return null;
  let settings;
  try {
    settings = JSON.parse(text);
  } catch (err) {
    throw new Error(`${CLAUDE_SETTINGS}을 읽을 수 없다 (${err.message})`);
  }
  const hooks = settings?.hooks;
  const isEntry = (e) => e && typeof e === 'object' && (e.hooks === undefined || (Array.isArray(e.hooks) && e.hooks.every((x) => x && typeof x === 'object')));
  const isValid = settings && typeof settings === 'object' && !Array.isArray(settings)
    && (hooks === undefined || (hooks && typeof hooks === 'object' && Object.values(hooks).every((v) => Array.isArray(v) && v.every(isEntry))));
  if (!isValid) throw new Error(`${CLAUDE_SETTINGS}의 hooks가 예상한 모양(이벤트마다 목록)이 아니다`);
  return settings;
}

function stripClaudeHooks(root, settings) {
  const rel = CLAUDE_SETTINGS;
  if (settings === null) return [];
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

// A line goes only when nothing is left for it to protect: the map settings, word list and
// measurements outlive uninstall, and dropping their line would let them be committed.
// ponytail: a line the person had before init goes too if its file is absent; record init's lines if that matters.
function stripGitignore(root) {
  const text = read(root, '.gitignore');
  const isStale = (l) => IGNORED.includes(l.trim()) && !fs.existsSync(path.join(root, l.trim()));
  if (text === null || !text.split('\n').some(isStale)) return [];
  rewrite(root, '.gitignore', text.split('\n').filter((l) => !isStale(l)).join('\n'));
  return ['.gitignore에서 지킬 파일이 없어진 qh 줄'];
}

// What init copied from qh, removed only while it still equals the shipped file.
function stripCopies(root, qhHome, kept) {
  const out = [];
  for (const { name, dir } of shippedSkills(qhHome)) {
    const rel = `${SKILLS_DIR}/${name}`;
    if (!fs.existsSync(path.join(root, rel))) continue;
    if (isSkillUnchanged(dir, path.join(root, rel))) { remove(root, rel); out.push(rel); } else kept.push(rel);
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
  const carries = { 'AGENTS.md': MARK_START, '.gitignore': IGNORED[0], '.claude/settings.json': 'qh.js' };
  const touched = Object.entries(carries).filter(([f, mark]) => read(root, f)?.includes(mark) && isGit(root, ['status', '--porcelain', '--', f])).map(([f]) => f);
  if (touched.length) {
    console.log(`커밋 안 된 변경이 있는 파일을 고쳐야 해서 멈춤 (되돌릴 수 없다): ${touched.join(', ')}\n먼저 커밋하거나 치운 뒤 다시 실행.`);
    return 1;
  }
  // Everything that could fail is read and checked before the first write: a bad file changes nothing.
  let settings;
  try {
    settings = readClaudeSettings(root);
  } catch (err) {
    console.log(`환경 오류 (코드를 고치지 말고 사용자에게 그대로 보고): ${err.message}\n파일을 고치거나 지운 뒤 다시 실행한다. 아무것도 바꾸지 않았다.`);
    return 1;
  }
  const kept = [];
  const removed = [
    ...stripRuleBlock(root),
    ...stripClaudeHooks(root, settings),
    ...stripCopies(root, qhHome, kept),
  ];
  for (const rel of [INSTALL_DIR, '.quality/evidence', '.kiro/hooks/qh.json']) {
    if (fs.existsSync(path.join(root, rel))) { remove(root, rel); removed.push(rel); }
  }
  removed.push(...stripGitignore(root));
  for (const dir of ['.kiro/hooks', '.kiro']) {
    const full = path.join(root, dir);
    if (fs.existsSync(full) && !fs.readdirSync(full).length) fs.rmdirSync(full);
  }
  console.log(removed.length ? `qh uninstall: 지움·되돌림\n${removed.map((r) => `  - ${r}`).join('\n')}` : 'qh uninstall: 지울 것이 없다 (이미 지워졌다)');
  if (kept.length) console.log(`남겨 둠 (설치본과 달라져 사람이 고친 것으로 본다): ${kept.join(', ')}`);
  console.log('남겨 둠 (직접 판단): .quality/config.json·access.json·probe.mjs·tasks·metrics.csv·reports, docs/decisions.md');
  console.log(`코드 지도(${MAP_TOOL})는 따로 지운다: \`${MAP_TOOL} uninstall --repo . --keep-user-configs -y\``);
  console.log('되돌리려면: 고쳐진 파일은 `git checkout -- <파일>`, 지워진 설치본은 `node <VibeRail 폴더>/bin/qh.js init .`');
  return 0;
}

module.exports = { uninstall };
