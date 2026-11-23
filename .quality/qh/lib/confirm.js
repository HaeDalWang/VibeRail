'use strict';

// Confirmation numbers (확인 번호, backlog 3, after plannotator's stale plan decisions): a person's pick
// of an interface option and their approval of the spec are bound to the content they saw, the way
// check evidence is bound to the tree hash. Whitespace does not count. When the content moves on,
// qh asks again through the same blocking question list as the waivers (lib/waivers.js).

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { section, SECTIONS } = require('./card');

const flat = (v) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v)).replace(/\s+/g, ' ').trim();

// 4 digits the person can read; 1 in 10,000 changes passes unnoticed (same trade-off as the secret-waiver number).
const confirmNumber = (text) => String(parseInt(createHash('sha256').update(flat(text)).digest('hex').slice(0, 8), 16) % 10000).padStart(4, '0');

const OPTION_FIELDS = ['id', 'name', 'summary', 'mermaid', 'gain', 'cost', 'signature', 'seam', 'questions'];
const FIELD_LABELS = { id: 'id', name: '이름', summary: '요약', mermaid: '그림', gain: '장점', cost: '비용', signature: 'signature', seam: '테스트 위치', questions: '질문' };

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

const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

// Committed versions of a file, newest first ({ sha, text }). The approved version is found by its number.
// ponytail: walks every commit of the file; cap it if design files ever get long histories.
function* committedVersions(root, rel) {
  const shas = (git(root, ['log', '--format=%H', '--', rel]).stdout || '').split('\n').filter(Boolean);
  for (const sha of shas) {
    const r = git(root, ['show', `${sha}:${rel}`]);
    if (r.status === 0) yield { sha, text: r.stdout };
  }
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// The picked option's fields that differ from the approved version, or null when that version is not in git.
function optionChanges(root, p, approved) {
  for (const { text } of committedVersions(root, p.rel)) {
    const old = (parse(text)?.options || []).find((o) => o.id === p.id);
    if (old && optionNumber(old) === approved) {
      const fields = OPTION_FIELDS.filter((k) => flat(old[k]) !== flat(p.option[k])).map((k) => ({ label: FIELD_LABELS[k], old: flat(old[k]), now: flat(p.option[k]) }));
      return { kind: 'option', fields };
    }
  }
  return null;
}

// The spec lines (`-old`, `+now`, whitespace ignored) since the approved version, or null when it is not in git.
function specChanges(root, rel, approved) {
  for (const { sha, text } of committedVersions(root, rel)) {
    if (confirmNumber(text) !== approved) continue;
    const diff = git(root, ['diff', '-w', '-U0', '--no-color', sha, '--', rel]).stdout || '';
    return { kind: 'spec', lines: diff.split('\n').filter((l) => /^[-+]/.test(l) && !/^(---|\+\+\+) /.test(l)) };
  }
  return null;
}

const NOT_FOUND = '예전 내용을 찾지 못했습니다. 지금 내용 전체를 다시 보세요.';

// The numbers the person approved in answered `- [x] <sentence> · <answer>` lines starting with `head`, oldest first.
// Each sentence ends with the number it binds: "(확인 번호 <old> → <new>)" or "(확인 번호 <new>)".
const approvedNumbers = (card, head) => cardLines(card, '판단 필요')
  .filter((l) => l.startsWith(`- [x] ${head}`) && / · \S/.test(l))
  .map((l) => (l.match(/확인 번호 (?:\d{4} → )?(\d{4})\)/) || [])[1])
  .filter(Boolean);

function optionConfirm(root, card) {
  const p = pickedOption(root, card);
  if (!p.id || !p.option) return [];
  const now = optionNumber(p.option);
  const approved = approvedNumbers(card, `고른 ${p.id}안`);
  if ([p.number, ...approved].includes(now)) return [];
  const bound = approved.at(-1) || p.number;
  if (!bound) return [{ agent: `고른 안에 확인 번호가 없다(${p.rel}) → 사용자에게 지금 내용으로 계속 쓸지 묻는다`, user: `고른 ${p.id}안(확인 번호 ${now})을 지금 내용 그대로 계속 쓸까요?`, changes: null }];
  const changes = optionChanges(root, p, bound);
  const shown = changes ? changes.fields.map((f) => `${f.label}: ${f.old} → ${f.now}`).join(' / ') : NOT_FOUND;
  return [{
    agent: `고른 안 확인 번호가 지금 설계안(${p.rel})과 다르다(${shown}) → 사용자에게 바뀐 칸을 보여 주고 바뀐 안으로 계속할지 묻는다. 아니라고 하면 안을 다시 고르게 한다`,
    user: `고른 ${p.id}안이 고른 뒤 바뀌었습니다(확인 번호 ${bound} → ${now}). ${changes ? '' : `${NOT_FOUND} `}바뀐 내용으로 계속할까요?`,
    changes,
  }];
}

// The spec is approved at loop start (the person's "돌려"), so it is asked only once 루프 lists a ticket.
function specConfirm(root, card) {
  const rel = lineAfter(cardLines(card, SECTIONS.interface), '명세').replace(/`/g, '');
  if (!rel || !cardLines(card, SECTIONS.loop).length || !fs.existsSync(path.join(root, rel))) return [];
  const now = confirmNumber(fs.readFileSync(path.join(root, rel), 'utf8'));
  const approved = approvedNumbers(card, '명세');
  if (approved.includes(now)) return [];
  const bound = approved.at(-1);
  if (!bound) return [{ agent: `루프 시작 전 명세 확인(${rel}) → 사용자가 "돌려"라고 하면 그 답으로 이 질문 줄을 적는다`, user: `명세(확인 번호 ${now})대로 작업을 시작할까요?`, changes: null }];
  const changes = specChanges(root, rel, bound);
  const shown = changes ? changes.lines.join(' / ') : NOT_FOUND;
  return [{
    agent: `확인한 명세(${rel})가 바뀌었다(${shown}) → 사용자에게 바뀐 줄을 보여 주고 바뀐 명세대로 계속할지 묻는다`,
    user: `명세가 확인한 뒤 바뀌었습니다(확인 번호 ${bound} → ${now}). ${changes ? '' : `${NOT_FOUND} `}바뀐 명세대로 계속할까요?`,
    changes,
  }];
}

// Questions still owed to the person: [{ agent, user, changes }] (the shape of pendingWaivers, plus changes).
// A question the card already holds as an open `- [ ]` line is an open decision there, not a second question.
const pendingConfirms = (root, { card }) => {
  const open = new Set(cardLines(card, '판단 필요'));
  return [...optionConfirm(root, card), ...specConfirm(root, card)].filter((q) => !open.has(`- [ ] ${q.user}`));
};

module.exports = { confirmNumber, optionNumber, pickedOption, pendingConfirms };
