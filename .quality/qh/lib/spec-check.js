'use strict';

// Spec check (명세 대조, GLOSSARY.md): before loop start, a fresh sub-agent compares what the person said
// (the task card) with the spec and the tickets. qh does not launch it (interface option B): it writes the
// task, then validates and records the result the sub-agent wrote. Who ran it is the agent's word only.

const fs = require('node:fs');
const path = require('node:path');
const { confirmNumber } = require('./confirm');
const { SECTIONS, pick, without, decisions, isYes, answerTo } = require('./card');
const { ticketPaths } = require('./cycle');

const DIR = '.quality/evidence/spec-check';
const TASK = `${DIR}/task.md`;
const RESULT = `${DIR}/result.json`;
const RECORDS = `${DIR}/records.json`;
const AXES = { missing: 'from', extra: 'where', noVisible: 'ticket' };

const specOf = (card) => pick(card).spec;
const readText = (root, rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : '');

// The card without the sections that change because of the check itself (answers, the loop round).
// ponytail: a grilling answer added after a pass does not trigger a rerun; bind 판단 필요 too if that bites.
const checkedCard = (card) => without(card, [SECTIONS.decisions, SECTIONS.loop]);

// A ticket without its progress: ticked boxes and the AFK/HITL status are set during the loop, not new content.
const ticketContent = (text) => text.replace(/^(\s*[-*] )\[[xX]\]/gm, '$1[ ]').replace(/^\*\*Status:\*\*.*$/gm, '');

// The number of the content the check judged: card (as above), spec and every linked ticket.
function contentNumber(root, card) {
  const spec = specOf(card);
  return confirmNumber([checkedCard(card), spec ? readText(root, spec) : '', ...ticketPaths(card).map((t) => ticketContent(readText(root, t)))].join('\n'));
}

function taskText(cardRel, card) {
  const spec = specOf(card) || '없음';
  return `# Spec check (명세 대조)

Compare what the person said with the spec and the tickets. You did not write them; judge only from the files.

## Input (relative to the working directory)
- What the person said: task card \`${cardRel}\`, all of it: intent and agreed scope, success conditions, answered \`- [x]\` lines under \`## 판단 필요\`, the picked option and its reason.
- Spec: \`${spec}\`
- Tickets:
${ticketPaths(card).map((t) => `  - \`${t}\``).join('\n')}

Read nothing outside the working directory. Do not modify any file except the result.

## Find
- missing: something the card says that neither the spec nor any ticket's acceptance criteria cover.
- extra: something the spec or a ticket adds that nothing on the card asks for.
- noVisible: a ticket whose acceptance criteria leave nothing the person can see when it is done (a screen, an output, a file).

## Output
Write \`${RESULT}\` as JSON: \`{ "missing": [{ "from": "<card line or section>", "text": "<one Korean line>" }], "extra": [{ "where": "<spec or ticket location>", "text": "<one Korean line>" }], "noVisible": [{ "ticket": "<ticket path>", "text": "<one Korean line>" }] }\`. All three arrays are required; empty means none.

Each \`text\` is a short Korean name of the item (a few words, no sentence), because qh puts it into a question to the person as OO:
- extra: "${QUESTION.extra({ text: 'OO' })}"
- missing: "${QUESTION.missing({ text: 'OO' })}"
- noVisible: the question names the ticket number, so \`text\` says what is missing in a few words.
`;
}

function writeTask(root, card) {
  fs.mkdirSync(path.join(root, DIR), { recursive: true });
  fs.writeFileSync(path.join(root, TASK), taskText(card.rel, card.text));
  return [
    `명세 대조 지시문: ${TASK}`,
    '새 하위 AI(Claude Code: Agent 도구, Kiro: 하위 에이전트)에 이 지시문 경로만 넘긴다. 명세를 쓴 이유·설명은 넘기지 않는다.',
    `하위 AI가 ${RESULT}를 쓰면: qh spec-check --result`,
  ].join('\n');
}

// Why the result is not usable, or null. Every axis is required: a dropped axis must not read as a pass.
function resultProblem(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '{ missing, extra, noVisible } 모양이 아니다';
  for (const [axis, key] of Object.entries(AXES)) {
    if (!Array.isArray(data[axis])) return `${axis} 배열이 없다`;
    if (!data[axis].every((x) => x && typeof x[key] === 'string' && typeof x.text === 'string')) return `${axis} 항목은 { ${key}, text } 문자열이어야 한다`;
  }
  return null;
}

// All cards' records; {} when there is no file yet. Throws when the file is there but unreadable.
const loadRecords = (root) => (fs.existsSync(path.join(root, RECORDS)) ? JSON.parse(fs.readFileSync(path.join(root, RECORDS), 'utf8')) : {});
// For reading only (gate, review page): an unreadable file reads as no record, so the check is asked again.
const readRecords = (root) => {
  try {
    return loadRecords(root);
  } catch {
    return {};
  }
};

// Fix rounds since the last pass: a pass starts the count again.
const roundsSincePass = (records) => records.length - 1 - records.findLastIndex((x) => !x.round);
const needsFix = (result) => result.missing.length > 0 || result.noVisible.length > 0;

function recordResult(root, card, file) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  } catch (e) {
    console.log(`명세 대조 결과를 읽지 못했다(JSON 아님 또는 파일 없음: ${file}): ${e.message}`);
    return 1;
  }
  const problem = resultProblem(data);
  if (problem) {
    console.log(`명세 대조 결과 형식이 틀리다(${file}): ${problem}. 기록하지 않았다.`);
    return 1;
  }
  let all;
  try {
    all = loadRecords(root);
  } catch (e) {
    console.log(`명세 대조 기록 파일(${RECORDS})을 읽지 못했다: ${e.message}. 다른 카드 기록을 지우지 않도록 기록하지 않았다. 파일을 고치거나 지운 뒤 다시 기록한다.`);
    return 1;
  }
  const mine = all[card.rel] || [];
  const result = Object.fromEntries(Object.keys(AXES).map((a) => [a, data[a]]));
  const round = needsFix(result) ? roundsSincePass(mine) + 1 : 0;
  const number = contentNumber(root, card.text);
  all[card.rel] = [...mine, { number, result, round, checker: 'agent-declared', at: new Date().toISOString() }];
  fs.mkdirSync(path.join(root, DIR), { recursive: true });
  fs.writeFileSync(path.join(root, RECORDS), `${JSON.stringify(all, null, 2)}\n`);
  const counts = Object.keys(AXES).map((a) => `${a} ${result[a].length}`).join(', ');
  console.log(`명세 대조 기록: 확인 번호 ${number} · ${counts}${round ? ` · 고치기 ${round}번째` : ''} (검사자: 에이전트 신고)`);
  return 0;
}

// Shape rules on the card's tickets, cheap enough for every check: the file exists, it has an acceptance
// box, and each blocker number names one of the card's tickets.
const ticketNo = (rel) => (path.basename(rel).match(/^(\d+)-/) || [])[1];
function shapeProblems(root, card) {
  const tickets = ticketPaths(card.text);
  const numbers = new Set(tickets.map(ticketNo));
  return tickets.flatMap((rel) => {
    if (!fs.existsSync(path.join(root, rel))) return [`작업 파일 ${rel}이 없다 → 카드의 작업 링크를 고치거나 파일을 쓴다`];
    const text = readText(root, rel);
    const out = /^\s*[-*] \[[ xX]\]/m.test(text) ? [] : [`작업 파일 ${rel}에 완료 조건(- [ ] 줄)이 없다 → 끝났는지 확인할 조건을 쓴다`];
    const blocked = (text.match(/^\*\*Blocked by:\*\*(.*)$/m) || [])[1] || '';
    const unknown = (blocked.match(/\b\d{2,}\b/g) || []).filter((n) => !numbers.has(n));
    if (unknown.length) out.push(`작업 파일 ${rel}의 앞선 작업 ${unknown.join(', ')}이 이 카드의 작업에 없다 → 번호를 고치거나 그 작업을 카드에 잇는다`);
    return out;
  });
}

const MAX_ROUNDS = 2;
const QUESTION = {
  extra: (x) => `명세에 '${x.text}'가 들어갔습니다. 원하신 건가요?`,
  missing: (x) => `작업 카드의 '${x.text}'가 명세·작업에 없습니다. 빼고 진행할까요?`,
  noVisible: (x) => `작업 '${ticketNo(x.ticket) || x.ticket}'은 끝나도 확인할 것이 없습니다. 그대로 진행할까요?`,
};
const ON_NO = { extra: '명세·작업에서 그 내용을 빼고', missing: '명세·작업에 그 내용을 넣고', noVisible: '그 작업의 완료 조건에 끝나면 볼 것을 넣고' };
const RUN = 'qh spec-check --task → 새 하위 AI → qh spec-check --result 순서로 돌린다';

// The gate before loop start: agent items (policy), person questions (the waiver shape), and whether
// "돌려" may be asked. A card with no linked tickets passes untouched.
function gate(root, card) {
  if (!ticketPaths(card.text).length) return { passed: true, agent: [], person: [] };
  const now = contentNumber(root, card.text);
  const last = (readRecords(root)[card.rel] || []).at(-1);
  if (!last || last.number !== now) return { passed: false, agent: [`명세 대조가 지금 내용(확인 번호 ${now})에 없다 → ${RUN}`], person: [] };
  const isFixing = last.round > 0 && last.round < MAX_ROUNDS;
  const agent = isFixing ? [`명세 대조 고치기 ${last.round}번째: ${[...last.result.missing, ...last.result.noVisible].map((x) => x.text).join(' / ')} → 명세·작업을 고치고 다시 ${RUN}`] : [];
  const person = [];
  const { open } = decisions(card.text);
  let isOpen = false;
  for (const axis of isFixing ? ['extra'] : ['extra', 'missing', 'noVisible']) {
    for (const x of last.result[axis]) {
      const user = QUESTION[axis](x);
      const answer = answerTo(card.text, user);
      isOpen ||= open.includes(user);
      if (answer === null && !open.includes(user)) person.push({ agent: `명세 대조 결과(검사자: 에이전트 신고) → 사용자에게 이 줄을 그대로 묻는다`, user, changes: null });
      else if (answer !== null && !isYes(answer)) agent.push(`명세 대조: 사용자가 "${answer}"라고 답했다(${user}) → ${ON_NO[axis]} 다시 ${RUN}`);
    }
  }
  return { passed: !agent.length && !person.length && !isOpen, agent, person };
}

// One line for the review page from the card's last record, or null when there is none.
function recordLine(root, card) {
  const last = (readRecords(root)[card.rel] || []).at(-1);
  if (!last) return null;
  const { missing, extra, noVisible } = last.result;
  const stale = last.number === contentNumber(root, card.text) ? '' : ' · 지금 내용과 다름(다시 검사 필요)';
  return `명세 대조(확인 번호 ${last.number}): 빠진 말 ${missing.length}, 끼어든 말 ${extra.length}, 끝나면 볼 것 없는 작업 ${noVisible.length}${stale} · 검사자: 에이전트 신고(기계 확인 아님)`;
}

function run(root, args, card) {
  if (args[0] === '--result') return recordResult(root, card, args[1] || RESULT);
  if (args[0] === '--task') {
    if (!ticketPaths(card.text).length) {
      console.log('대조할 작업이 없다: 카드에 이은 작업 파일이 없어 지시문을 쓰지 않았다');
      return 1;
    }
    console.log(writeTask(root, card));
    return 0;
  }
  console.log('사용법: qh spec-check --task | --result [파일]');
  return 2;
}

module.exports = { run, gate, recordLine, shapeProblems, contentNumber, RESULT, RECORDS };
