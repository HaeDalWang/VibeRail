'use strict';

// Confirmation numbers (확인 번호, backlog 3, after plannotator's stale plan decisions): a person's pick
// of an interface option and their approval of the spec are bound to the content they saw, the way
// check evidence is bound to the tree hash. Whitespace does not count. When the content moves on,
// qh asks again through the same blocking question list as the waivers (lib/waivers.js).

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { section, SECTIONS } = require('./card');

const flat = (v) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v)).replace(/\s+/g, ' ').trim();

// 4 digits the person can read; 1 in 10,000 changes passes unnoticed (same trade-off as the secret-waiver number).
const confirmNumber = (text) => String(parseInt(createHash('sha256').update(flat(text)).digest('hex').slice(0, 8), 16) % 10000).padStart(4, '0');

const OPTION_FIELDS = ['id', 'name', 'summary', 'mermaid', 'gain', 'cost', 'signature', 'seam', 'questions'];

// The picked option's own fields only: edits to the options not picked change nothing.
const optionNumber = (option) => confirmNumber(OPTION_FIELDS.map((k) => `${k}:${flat(option?.[k])}`).join('\n'));

const cardLines = (card, name) => (section(card, name) || '').split('\n').map((l) => l.trim()).filter(Boolean);
const lineAfter = (lines, label) => (lines.find((l) => l.startsWith(`${label}:`)) || '').slice(label.length + 1).trim();

function readJson(root, rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  } catch {
    return null;
  }
}

// The card's pick: { id, number (null when the line has none), rel, design (null when unreadable), option (null when gone) }.
function pickedOption(root, card) {
  const lines = cardLines(card, SECTIONS.interface);
  const pick = lineAfter(lines, '안');
  const id = pick.split(/[\s(]/)[0];
  const rel = lineAfter(lines, '설계안').replace(/`/g, '');
  const design = rel ? readJson(root, rel) : null;
  return { id, number: (pick.match(/확인 번호 (\d{4})/) || [])[1] || null, rel, design, option: (design?.options || []).find((o) => o.id === id) || null };
}

// The numbers the person approved in answered `- [x] <sentence> · <answer>` lines starting with `head`, oldest first.
// Each sentence ends with the number it binds: "(확인 번호 <old> → <new>)" or "(확인 번호 <new>)".
const approvedNumbers = (card, head) => cardLines(card, '판단 필요')
  .filter((l) => l.startsWith(`- [x] ${head}`) && / · \S/.test(l))
  .map((l) => (l.match(/확인 번호 (?:\d{4} → )?(\d{4})\)/) || [])[1])
  .filter(Boolean);

// Questions still owed to the person: [{ agent, user, changes }] (the shape of pendingWaivers, plus changes).
function pendingConfirms(root, { card }) {
  const p = pickedOption(root, card);
  if (!p.id || !p.option) return [];
  const now = optionNumber(p.option);
  const bound = approvedNumbers(card, `고른 ${p.id}안`).at(-1) || p.number;
  if (bound === now) return [];
  const user = bound
    ? `고른 ${p.id}안이 고른 뒤 바뀌었습니다(확인 번호 ${bound} → ${now}). 바뀐 내용으로 계속할까요?`
    : `고른 ${p.id}안(확인 번호 ${now})을 지금 내용 그대로 계속 쓸까요?`;
  return [{ agent: `고른 안 확인 번호가 지금 설계안(${p.rel})과 다르다 → 사용자에게 바뀐 안으로 계속할지 묻는다. 아니라고 하면 안을 다시 고르게 한다`, user, changes: null }];
}

module.exports = { confirmNumber, optionNumber, pickedOption, pendingConfirms };
