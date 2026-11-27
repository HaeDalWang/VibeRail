'use strict';

// `qh cycle` and the SessionStart line: which stage the current task card is at, the
// next decision that belongs to the person, and whether the periodic architecture check
// is due (config `limits`: 3 cards added or 7 days since the last `아키텍처 점검:` line by default).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SECTIONS, section, answerTo, isYes } = require('./card');
const { declared, declaredReason, isRealReason, DECISIONS_FILE, LIMITS } = require('./policy');

const DAY_MS = 86400000;
const CARD_GLOB = '.quality/tasks/*.md';
const CHECK_LINE = /아키텍처 점검:\s*(\d{4}-\d{2}-\d{2})/g;
const NEXT = {
  의도: '범위 확정 (정한 범위를 보여 주고 사용자에게 그대로 묻는다: 이 범위로 진행할까요?)',
  'interface 결정': '구조 고르기 (그림을 보고 하나 고르고 이유 한 줄)',
  '테스트 위치': '테스트 위치(seam) 정하기',
  루프: '루프 시작 (이번에 돌릴 티켓 최대 3개와 사람 몫 티켓을 보고 "돌려")',
  완료: '완료 리뷰 (바뀐 구조와 테스트를 사용자가 확인)',
};
const TICKET_PATH = /\.scratch\/[^\s/`'")\]]+\/issues\/[^\s`'")\]]+\.md/g;

const ticketPaths = (text) => [...new Set(text.match(TICKET_PATH) || [])];
const ticketText = (root, rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : '');
// Done: at least one ticked acceptance box and none open.
const isDone = (text) => /^\s*[-*] \[[xX]\]/m.test(text) && !/^\s*[-*] \[ \]/m.test(text);

// Loop state once the seams are set; null when the card references no ticket files.
function loopOf(root, card) {
  const refs = ticketPaths(card);
  if (!refs.length) return null;
  const round = ticketPaths(section(card, SECTIONS.loop) || '');
  const done = (t) => isDone(ticketText(root, t));
  return {
    round,
    done: round.filter(done),
    open: refs.filter((t) => !round.includes(t) && !done(t)),
    human: round.filter((t) => /\*\*Status:\*\*\s*ready-for-human/.test(ticketText(root, t))),
  };
}

// The first stage whose section is still missing; a declared small fix skips the cycle.
function stageOf(card, root) {
  if (declared(card, 'grilling 불필요')) return '완료';
  const intent = (section(card, SECTIONS.intent) || '').split('\n').filter((l) => declaredReason(l, 'grilling 불필요') === null).join('').trim();
  if (!intent || !isYes(answerTo(card, '이 범위로 진행할까요?') || '')) return '의도';
  const chosen = section(card, SECTIONS.interface);
  if (!chosen || !isRealReason(declaredReason(chosen, '이유') || '')) return 'interface 결정';
  if (!section(card, SECTIONS.seam)) return '테스트 위치';
  const loop = root && loopOf(root, card);
  if (loop && loop.done.length < Math.max(loop.round.length, 1)) return '루프';
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
  if (fresh.length < LIMITS.architectureCards && days < LIMITS.architectureDays) return null;
  return `아키텍처 점검 시기: ${last ? '지난 점검' : '첫 카드'} 뒤 카드 ${fresh.length}개, ${days}일 → 사용자에게 구조 후보 점검을 시작할지 묻는다 (후보 하나를 고르고 이유 한 줄)`;
}

// The loop's lines: the stage line (progress, or the remainder after a finished round) and any warnings.
function loopLines(loop, stage) {
  const { round, done, open, human } = loop;
  const out = [];
  if (round.length && stage === '루프') out.push(`카드 단계: 루프 진행 ${done.length}/${round.length} · 다음 결정 ◆ 완료 리뷰 (루프가 끝나거나 멈추면)`);
  if (round.length && stage === '완료') out.push(`카드 단계: 완료 · 다음 결정 ◆ ${NEXT.완료}${open.length ? ` · 남은 티켓 ${open.length}개는 리뷰 뒤 다음 루프로 다시 정함` : ''}`);
  if (round.length > LIMITS.loopTickets) out.push(`루프: 이번 묶음이 ${round.length}개라 한도 ${LIMITS.loopTickets}개를 넘었다 → ${LIMITS.loopTickets}개로 줄여 다시 정한다`);
  for (const t of human) out.push(`루프: 사람 몫 티켓(${t})이 묶음에 있다 → 루프에서 빼고 사용자에게 넘긴다`);
  return out;
}

// The lines to show: stage and next decision, then loop warnings and the architecture check when due.
function cycleLines(root, card, { always = false } = {}) {
  if (!always && !isCycleProject(root, card)) return [];
  const stage = stageOf(card, root);
  const loop = stage === '루프' || stage === '완료' ? loopOf(root, card) : null;
  const lines = loop && loop.round.length && !declared(card, 'grilling 불필요') ? loopLines(loop, stage) : [`카드 단계: ${stage} · 다음 결정 ◆ ${NEXT[stage]}`];
  return [...lines, architectureDue(root)].filter(Boolean);
}

module.exports = { cycleLines, ticketPaths };
