'use strict';

// The skills qh ships (skills/): Pocock's, vendored unedited, and qh-cycle. `qh init` copies
// them into the project's .claude/skills/<name>/ byte for byte, overwriting on every run
// (they are qh's files, not the person's), and puts the agent docs those skills read in
// docs/agents/ only when missing. qh's own install (.quality/qh/) carries skills/ too, so
// an init run from a project copy installs the same.

const fs = require('node:fs');
const path = require('node:path');

const VENDOR = 'skills/vendor/mattpocock-skills';
const SKILLS_DIR = '.claude/skills';
const KEEP_FILE = '.scratch/.gitkeep';
const AGENT_DOCS = [['issue-tracker-local.md', 'docs/agents/issue-tracker.md'], ['triage-labels.md', 'docs/agents/triage-labels.md'], ['domain.md', 'docs/agents/domain.md']];

const filesUnder = (dir) => fs.globSync('**/*', { cwd: dir }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort();

// { name, dir } for each skill folder (one holding SKILL.md) that qh ships.
function shippedSkills(qhHome) {
  const parents = [path.join(qhHome, VENDOR), path.join(qhHome, 'skills')];
  return parents.filter((p) => fs.existsSync(p)).flatMap((p) => fs.readdirSync(p)
    .filter((n) => fs.existsSync(path.join(p, n, 'SKILL.md'))).map((n) => ({ name: n, dir: path.join(p, n) })));
}

// Every file under skills/, as [path under qhHome, text], for the copy in .quality/qh/.
const shippedFiles = (qhHome) => (fs.existsSync(path.join(qhHome, 'skills')) ? filesUnder(path.join(qhHome, 'skills')) : [])
  .map((f) => [path.join('skills', f), fs.readFileSync(path.join(qhHome, 'skills', f), 'utf8')]);

// write(rel, body) plans one file; read(rel) is the project's current text or null.
function installSkills(qhHome, write, read) {
  for (const { name, dir } of shippedSkills(qhHome)) {
    for (const f of filesUnder(dir)) write(path.join(SKILLS_DIR, name, f), fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  // MIT: the copies carry the upstream notice.
  write(path.join(SKILLS_DIR, 'mattpocock-skills.LICENSE'), fs.readFileSync(path.join(qhHome, VENDOR, 'LICENSE'), 'utf8'));
  for (const [from, to] of AGENT_DOCS) {
    if (read(to) === null) write(to, fs.readFileSync(path.join(qhHome, VENDOR, 'agents-docs', from), 'utf8'));
  }
  if (read(KEEP_FILE) === null) write(KEEP_FILE, '');
}

// An installed skill file is overwritten without asking; a person's other files are not.
const isInstalledSkill = (qhHome, rel) => rel === `${SKILLS_DIR}/mattpocock-skills.LICENSE` || (rel.startsWith(`${SKILLS_DIR}/`) && shippedSkills(qhHome).some((s) => s.name === rel.split('/')[2]));

module.exports = { installSkills, shippedFiles, shippedSkills, isInstalledSkill, SKILLS_DIR, VENDOR };
