'use strict';

// Spec check (명세 대조, GLOSSARY.md): before loop start, a fresh sub-agent compares what the person said
// (the task card) with the spec and the tickets. qh does not launch it (interface option B): it writes the
// task, then validates and records the result the sub-agent wrote. Who ran it is the agent's word only.

const fs = require('node:fs');
const path = require('node:path');
const { confirmNumber } = require('./confirm');
const { SECTIONS } = require('./card');
const { ticketPaths } = require('./cycle');

const DIR = '.quality/evidence/spec-check';
const TASK = `${DIR}/task.md`;
const RESULT = `${DIR}/result.json`;
const RECORDS = `${DIR}/records.json`;
const AXES = { missing: 'from', extra: 'where', noVisible: 'ticket' };

const specOf = (card) => (card.match(/^명세:\s*`?([^`\n]+?)`?\s*$/m) || [])[1] || null;
const readText = (root, rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : '');

// The card without the sections that change because of the check itself (answers, the loop round).
// ponytail: a grilling answer added after a pass does not trigger a rerun; bind 판단 필요 too if that bites.
const checkedCard = (card) => card.split(/^(?=## )/m).filter((s) => !s.startsWith(`## ${SECTIONS.decisions}`) && !s.startsWith(`## ${SECTIONS.loop}`)).join('');

// The number of the content the check judged: card (as above), spec and every linked ticket.
function contentNumber(root, card) {
  const spec = specOf(card);
  return confirmNumber([checkedCard(card), spec ? readText(root, spec) : '', ...ticketPaths(card).map((t) => readText(root, t))].join('\n'));
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
Write \`${RESULT}\` as JSON: \`{ "missing": [{ "from": "<card line or section>", "text": "<one Korean line>" }], "extra": [{ "where": "<spec or ticket location>", "text": "<one Korean line>" }], "noVisible": [{ "ticket": "<ticket path>", "text": "<one Korean line>" }] }\`. All three arrays are required; empty means none. Each text is one plain Korean line the person can read.
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

const readRecords = (root) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, RECORDS), 'utf8'));
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
  const all = readRecords(root);
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

module.exports = { run, shapeProblems, contentNumber, RESULT, RECORDS };
