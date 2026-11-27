'use strict';

// Spec check (명세 대조): qh writes the task for a fresh sub-agent and validates and records its result.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { repo, write, qh, BASIC, DECLARED } = require('./helpers');

const SPEC = '.scratch/f/spec.md';
const T1 = '.scratch/f/issues/01-a.md';
const T2 = '.scratch/f/issues/02-b.md';
const TICKET = (n, blocked = 'None (can start immediately)') => `# ${n}: t\n\n**What to build:** x\n\n**Blocked by:** ${blocked}\n\n**Status:** ready-for-agent\n\n- [ ] it works\n`;
const CARD = `${DECLARED}## 의도\n\n할 일을 지운다\n\n## interface 결정\n안: A\n이유: 쉽다\n명세: ${SPEC}\n작업: ${T1} ${T2}\n\n## 판단 필요\n`;
const RESULT = '.quality/evidence/spec-check/result.json';

function setup() {
  const root = repo(BASIC);
  write(root, '.quality/tasks/work.md', CARD);
  write(root, SPEC, '# Spec\n\n- delete a todo\n');
  write(root, T1, TICKET('01'));
  write(root, T2, TICKET('02', '01'));
  return root;
}

test('--task writes a task naming the card, spec, tickets and result path, and says what to do next', () => {
  const root = setup();
  const r = qh(root, ['spec-check', '--task']);
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  const taskRel = (r.stdout.match(/(\.quality\/evidence\/spec-check\/\S+\.md)/) || [])[1];
  assert.ok(taskRel, `the output names the task file: ${r.stdout}`);
  const task = fs.readFileSync(path.join(root, taskRel), 'utf8');
  for (const rel of ['.quality/tasks/work.md', SPEC, T1, T2, RESULT]) assert.ok(task.includes(rel), `task names ${rel}`);
  assert.match(r.stdout, /spec-check --result/, 'the output says how to record the result');
  assert.match(task, /명세에 'OO'가 들어갔습니다\. 원하신 건가요\?/, 'the task shows the question each text goes into, so it is a short name');
});

const RECORDS = '.quality/evidence/spec-check/records.json';
const records = (root) => (fs.existsSync(path.join(root, RECORDS)) ? JSON.parse(fs.readFileSync(path.join(root, RECORDS), 'utf8')) : null);

test('--result records a well-formed result with the content number and an agent-declared checker', () => {
  const root = setup();
  write(root, RESULT, JSON.stringify({ missing: [], extra: [{ where: 'spec', text: '정렬이 들어감' }], noVisible: [] }));
  const r = qh(root, ['spec-check', '--result']);
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  const number = (r.stdout.match(/확인 번호 (\d{4})/) || [])[1];
  assert.ok(number, `the output names the content number: ${r.stdout}`);
  const [rec] = records(root)['.quality/tasks/work.md'];
  assert.strictEqual(rec.number, number);
  assert.strictEqual(rec.checker, 'agent-declared');
  assert.deepStrictEqual(rec.result.extra, [{ where: 'spec', text: '정렬이 들어감' }]);
});

test('--result refuses a malformed result with the reason and records nothing', () => {
  for (const [body, why] of [['not json', /JSON/], [JSON.stringify({ missing: [], extra: [] }), /noVisible/], [JSON.stringify({ missing: [{ text: 'x' }], extra: [], noVisible: [] }), /missing/]]) {
    const root = setup();
    write(root, RESULT, body);
    const r = qh(root, ['spec-check', '--result']);
    assert.notStrictEqual(r.status, 0, `refused: ${body}`);
    assert.match(r.stdout + r.stderr, why);
    assert.strictEqual(records(root), null, 'nothing recorded');
  }
});

test('a result with missing items or tickets with no visible result counts one round for the card', () => {
  const root = setup();
  const round = (result) => {
    write(root, RESULT, JSON.stringify(result));
    return qh(root, ['spec-check', '--result']).stdout;
  };
  assert.match(round({ missing: [{ from: '의도', text: '지우기가 없음' }], extra: [], noVisible: [] }), /1번째/);
  assert.match(round({ missing: [], extra: [], noVisible: [{ ticket: T2, text: '볼 것 없음' }] }), /2번째/);
  assert.doesNotMatch(round({ missing: [], extra: [], noVisible: [] }), /번째/, 'a pass is not a fix round');
  assert.strictEqual(records(root)['.quality/tasks/work.md'].filter((x) => x.round).length, 2);
});

test('--task with no linked tickets stops without writing a task', () => {
  const root = repo(BASIC);
  write(root, '.quality/tasks/work.md', `${DECLARED}## 의도\n\nx\n`);
  const r = qh(root, ['spec-check', '--task']);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout, /대조할 작업이 없다/);
  assert.ok(!fs.existsSync(path.join(root, '.quality/evidence/spec-check/task.md')));
});

test('fix rounds count again from 1 after a pass', () => {
  const root = setup();
  const send = (result) => {
    write(root, RESULT, JSON.stringify(result));
    return qh(root, ['spec-check', '--result']).stdout;
  };
  const gap = { missing: [{ from: '의도', text: '없음' }], extra: [], noVisible: [] };
  send(gap);
  send({ missing: [], extra: [], noVisible: [] });
  assert.match(send(gap), /고치기 1번째/);
});

test('--result does not overwrite a records file it cannot read', () => {
  const root = setup();
  write(root, RECORDS, '{ broken');
  write(root, RESULT, JSON.stringify({ missing: [], extra: [], noVisible: [] }));
  const r = qh(root, ['spec-check', '--result']);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout, /기록 파일/);
  assert.strictEqual(fs.readFileSync(path.join(root, RECORDS), 'utf8'), '{ broken', 'left as it was');
});
