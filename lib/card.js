'use strict';

// Reading the task card's qh-cycle sections (## 의도, ## interface 결정, ## 테스트 위치(seam), ## 루프)
// and the lines a change added. Pure parsing: the rules live in policy.js and cycle.js.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SECTIONS = { intent: '의도', interface: 'interface 결정', seam: '테스트 위치(seam)', loop: '루프', decisions: '판단 필요' };

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

// `## 판단 필요`, read one way for every caller: a list line (`-`, `*` or `+`, any indentation) with
// `[ ]` is an open question, with `[x]`/`[X]` an answered line (`question · answer`). A top-level list
// line without a checkbox is plain (the format check flags it); indented ones are notes under an item.
const NOTHING = /^\(?(없음|없다|none|n\/a)\)?\.?$/i;
function decisions(card) {
  const out = { open: [], plain: [], answered: [] };
  for (const line of (section(card, SECTIONS.decisions) || '').split('\n')) {
    const m = line.match(/^(\s*)[-*+]\s+(?:\[([ xX])\](?:\s+|$))?(.*)$/);
    const text = m ? m[3].trim() : '';
    if (!text) continue;
    if (m[2] === ' ') out.open.push(text);
    else if (m[2]) out.answered.push(text);
    else if (!m[1] && !NOTHING.test(text)) out.plain.push(text);
  }
  return out;
}

// 'yes' (an answered line for the question with a non-empty answer), 'open' (an open line), or 'none'.
function answerState(card, question) {
  const d = decisions(card);
  const head = `${question} ·`;
  if (d.answered.some((t) => t.startsWith(head) && t.slice(head.length).trim() !== '')) return 'yes';
  return d.open.includes(question) ? 'open' : 'none';
}

// Only a yes approves a confirmation or a waiver (decision 2026-11-23): 예/네/돌려/진행 as the first word,
// so "진행하지 마세요" or "아니요, 돌려 주세요" is not one. Anything else stops and goes back to the agent.
const isYes = (answer) => /^(예|네+|넵|응|돌려|진행)(?=$|[\s,.!~)]|요|해|줘|하세요|합시다|할게요)/.test(answer.trim());

// The answer on the last answered line for exactly this question, or null.
function answerTo(card, question) {
  const head = `${question} · `;
  const line = decisions(card).answered.filter((t) => t.startsWith(head)).at(-1);
  return line === undefined ? null : line.slice(head.length).trim();
}

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

module.exports = { SECTIONS, section, seamPaths, decisions, answerState, isYes, answerTo, addedLines };
