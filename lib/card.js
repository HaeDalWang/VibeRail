'use strict';

// Reading the task card's qh-cycle sections (## 의도, ## interface 결정, ## 테스트 위치(seam), ## 루프)
// and the lines a change added. Pure parsing: the rules live in policy.js and cycle.js.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SECTIONS = { intent: '의도', interface: 'interface 결정', seam: '테스트 위치(seam)', loop: '루프' };

// Text under `## <name>` up to the next `##`, HTML comments removed; null when the heading is absent.
function section(card, name) {
  const body = card.split(/^## /m).slice(1).find((s) => s.startsWith(name) && /^\s*$/.test(s.split('\n')[0].slice(name.length)));
  if (body === undefined) return null;
  const nl = body.indexOf('\n');
  return nl === -1 ? '' : body.slice(nl + 1).replace(/<!--[\s\S]*?-->/g, '').trim();
}

// One path per line, list markers and backticks dropped.
const seamPaths = (card) => (section(card, SECTIONS.seam) || '').split('\n')
  .map((l) => l.replace(/`/g, '').replace(/^\s*([-*+]\s+)?/, '').replace(/\/+$/, '').trim()).filter(Boolean);

// Lines this work added to f: all of them for a file that is new since base, else the diff's + lines.
function addedLines(root, base, f) {
  const inBase = spawnSync('git', ['cat-file', '-e', `${base}:${f}`], { cwd: root }).status === 0;
  if (!inBase) {
    const file = path.join(root, f);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
  }
  const r = spawnSync('git', ['-c', 'core.quotepath=false', 'diff', '-U0', base, '--', f], { cwd: root, encoding: 'utf8' });
  return (r.stdout || '').split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
}

module.exports = { SECTIONS, section, seamPaths, addedLines };
