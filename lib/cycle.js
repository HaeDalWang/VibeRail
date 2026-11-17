'use strict';

// `qh cycle` and the SessionStart line: which stage the current task card is at, the
// next decision that belongs to the person, and whether the periodic architecture check
// is due (3 cards added or 7 days since the last `아키텍처 점검:` line).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SECTIONS, section } = require('./card');
const { declared, declaredReason, isRealReason, DECISIONS_FILE } = require('./policy');

const CARDS_DUE = 3;
const DAYS_DUE = 7;
const DAY_MS = 86400000;
const CARD_GLOB = '.quality/tasks/*.md';
const CHECK_LINE = /아키텍처 점검:\s*(\d{4}-\d{2}-\d{2})/g;
const NEXT = {
  의도: '범위 확정 (물어서 정한 범위를 사용자가 확인)',
  'interface 결정': '구조 고르기 (그림을 보고 하나 고르고 이유 한 줄)',
  '테스트 위치': '테스트 위치(seam) 정하기',
  완료: '완료 리뷰 (바뀐 구조와 테스트를 사용자가 확인)',
};

// The first stage whose section is still missing; a declared small fix skips the cycle.
function stageOf(card) {
  if (declared(card, 'grilling 불필요')) return '완료';
  const intent = (section(card, SECTIONS.intent) || '').split('\n').filter((l) => declaredReason(l, 'grilling 불필요') === null).join('').trim();
  if (!intent) return '의도';
  const chosen = section(card, SECTIONS.interface);
  if (!chosen || !isRealReason(declaredReason(chosen, '이유') || '')) return 'interface 결정';
  if (!section(card, SECTIONS.seam)) return '테스트 위치';
  return '완료';
}

const hasCycleHeading = (card) => Object.values(SECTIONS).some((n) => section(card, n) !== null);
const hasCycleSkill = (root) => fs.existsSync(path.join(root, '.claude/skills/qh-cycle/SKILL.md'));
// SessionStart speaks only in a project that uses the cycle.
const isCycleProject = (root, card) => hasCycleSkill(root) || hasCycleHeading(card);

const gitOut = (root, args) => spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, encoding: 'utf8' }).stdout || '';
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.floor((Date.parse(to) - Date.parse(from)) / DAY_MS);

// [{ file, date }] for every task card added in git (committed, or new in the working tree; those count as today).
function addedCards(root) {
  const committed = gitOut(root, ['log', '--diff-filter=A', '--format=@%cs', '--name-only', '--', CARD_GLOB]).split('\n').reduce((acc, line) => {
    if (line.startsWith('@')) acc.date = line.slice(1);
    else if (line.trim()) acc.list.push({ file: line.trim(), date: acc.date });
    return acc;
  }, { date: today(), list: [] }).list;
  const fresh = [...gitOut(root, ['ls-files', '--others', '--exclude-standard', '--', CARD_GLOB]).split('\n'), ...gitOut(root, ['diff', '--name-only', '--diff-filter=A', 'HEAD', '--', CARD_GLOB]).split('\n')]
    .filter(Boolean).map((file) => ({ file, date: today() }));
  const byFile = new Map();
  for (const c of [...committed, ...fresh]) if (!byFile.has(c.file) || c.date < byFile.get(c.file).date) byFile.set(c.file, c);
  return [...byFile.values()];
}

// null when not due, else the sentence. No `아키텍처 점검:` line yet: counted from the first card.
function architectureDue(root) {
  const cards = addedCards(root);
  if (!cards.length) return null;
  const log = fs.existsSync(path.join(root, DECISIONS_FILE)) ? fs.readFileSync(path.join(root, DECISIONS_FILE), 'utf8') : '';
  const last = [...log.matchAll(CHECK_LINE)].map((m) => m[1]).sort().pop();
  const since = last || cards.map((c) => c.date).sort()[0];
  const fresh = cards.filter((c) => !last || c.date > last);
  const days = daysBetween(since, today());
  if (fresh.length < CARDS_DUE && days < DAYS_DUE) return null;
  return `아키텍처 점검 시기: ${last ? '지난 점검' : '첫 카드'} 뒤 카드 ${fresh.length}개, ${days}일 → 사용자에게 구조 후보 점검을 시작할지 묻는다 (후보 하나를 고르고 이유 한 줄)`;
}

// The lines to show: stage and next decision, then the architecture check when due.
function cycleLines(root, card, { always = false } = {}) {
  if (!always && !isCycleProject(root, card)) return [];
  const stage = stageOf(card);
  return [`카드 단계: ${stage} · 다음 결정 ◆ ${NEXT[stage]}`, architectureDue(root)].filter(Boolean);
}

module.exports = { cycleLines, stageOf, architectureDue };
