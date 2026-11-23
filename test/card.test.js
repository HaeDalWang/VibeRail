'use strict';

// What the agent writes down (task card, decision log) and what counts as a test or a secret.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { repo, write, qh, statusJson, stopDecision, BASIC } = require('./helpers');

const policyOf = (root) => statusJson(root).policy.join('\n');
const DOCS_OK = '문서 영향 없음: 사용자에게 안 보임\n';

test('a declaration is read in common markdown shapes, in backticks and with a full-width colon', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', '2');
  const reason = '상수 하나만 바꿈';
  const shapes = [
    `- [x] 테스트 불필요: ${reason}`,
    `* 테스트 불필요: ${reason}`,
    `> 테스트 불필요: ${reason}`,
    `1. 테스트 불필요: ${reason}`,
    `\`테스트 불필요: ${reason}\``,
    `- \`테스트 불필요: ${reason}\``,
    `**테스트 불필요**: ${reason}`,
    `**테스트 불필요:** ${reason}`,
    `테스트 불필요：${reason}`,
  ];
  for (const shape of shapes) {
    write(root, '.quality/tasks/work.md', `${DOCS_OK}${shape}\n`);
    assert.doesNotMatch(policyOf(root), /TDD/, shape);
  }
});

test('a declaration with a too-short reason says the reason needs five characters', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', '2');
  write(root, '.quality/tasks/work.md', `${DOCS_OK}테스트 불필요: 내부용\n`);
  assert.match(policyOf(root), /TDD:.*이유는 5자 이상/);
});

test('an open card decision tells the agent to tick it once the person answered', () => {
  const root = repo(BASIC);
  write(root, '.quality/tasks/work.md', '## 판단 필요\n- [ ] 관리자는 모든 회사를 보나?\n');
  assert.match(qh(root, ['status']).stdout, /관리자는 모든 회사를 보나\?.*답을 받으면 `- \[x\]`로 바꾼다/);
});

test('a task-question answer clears the question when the risk name has Korean or dots', () => {
  const config = { ...BASIC, risks: { 결제: { paths: ['src/pay/**'] }, 'pay.v2': { paths: ['src/v2/**'] } } };
  const root = repo(config);
  write(root, 'src/pay/a.js', '1');
  write(root, 'src/v2/a.js', '1');
  assert.strictEqual(statusJson(root).taskQuestions.length, 2);
  write(root, '.quality/tasks/work.md', '작업 질문 결제: B 금액 계산 그대로\n- 작업 질문 pay.v2: B 동작 그대로\n');
  assert.deepStrictEqual(statusJson(root).taskQuestions, []);
});

test('a tracked .env file that this work deletes is not a secret file', () => {
  const root = repo(BASIC, { '.env': 'API_TOKEN=abc123\n' });
  fs.rmSync(path.join(root, '.env'));
  write(root, '.gitignore', '.env\n');
  assert.doesNotMatch(policyOf(root), /비밀값 파일/);
});

test('a .env file blocks only when a value looks like a secret', () => {
  const root = repo(BASIC);
  write(root, '.env.development', 'API_URL=http://localhost:3000\n');
  assert.doesNotMatch(policyOf(root), /비밀값 파일/);
  write(root, '.env.development', 'API_URL=http://localhost:3000\nAPI_TOKEN=abc123\n');
  assert.match(policyOf(root), /비밀값 파일: \.env\.development/);
});

test('Tests folders, *Tests/*Test class files and Cypress .cy. files count as tests', () => {
  const root = repo(BASIC);
  write(root, '.quality/tasks/work.md', DOCS_OK);
  const pairs = [
    ['src/App.swift', 'Tests/AppTests.swift'],
    ['src/Foo.cs', 'App.Tests/FooTests.cs'],
    ['src/login.ts', 'cypress/e2e/login.cy.ts'],
    ['src/Foo.java', 'src/FooTest.java'],
    ['src/Bar.kt', 'src/BarTests.kt'],
  ];
  for (const [code, testFile] of pairs) {
    write(root, code, 'x');
    write(root, testFile, 'x');
    assert.doesNotMatch(policyOf(root), /TDD/, testFile);
    fs.rmSync(path.join(root, code));
    fs.rmSync(path.join(root, testFile));
  }
});

test('a check already failing on the base, allowed in the decision log, only warns', () => {
  const root = repo({ ...BASIC, checks: { unit: { cmd: 'node -e "process.exit(1)"' } } });
  write(root, 'src/a.js', '2');
  write(root, '.quality/tasks/work.md', '테스트 불필요: 상수 하나만 바꿈\n');
  write(root, 'docs/decisions.md', '- 2026-11-18 · 기존 실패 허용: unit · main에서도 실패하고 따로 고친다 · 고쳐지면\n');
  assert.strictEqual(qh(root, ['check']).status, 0);
  const out = qh(root, ['status']).stdout;
  assert.doesNotMatch(out, /AI가 고칠 일/);
  assert.match(out, /경고 \(막지 않음\)[\s\S]*unit/);
  const d = stopDecision(qh(root, ['hook', 'stop'], '{}'));
  assert.notStrictEqual(d?.decision, 'block');
  assert.match(d.systemMessage, /이 작업 전부터 실패하던 것이라/);
});

test('a card section that ends the file with no newline after its heading reads as empty, not as its heading', () => {
  const { section } = require('../lib/card');
  assert.strictEqual(section('# 카드\n## 의도', '의도'), '');
  assert.strictEqual(section('# 카드\n## 의도\n', '의도'), '');
  assert.strictEqual(section('# 카드\n## 의도\n고칠 것\n', '의도'), '고칠 것');
  assert.strictEqual(section('# 카드\n', '의도'), null);
});

// The 판단 필요 section, read one way for every caller (decision-list spec).
const decisionCard = (body) => `# 카드\n## 의도\n고친다\n\n## 판단 필요\n${body}\n## 미확인\n`;

test('indented checkbox lines are read', () => {
  const { decisions } = require('../lib/card');
  const d = decisions(decisionCard('  - [ ] 들여쓴 질문\n\t- [x] 들여쓴 답 · 네'));
  assert.deepStrictEqual(d.open, ['들여쓴 질문']);
  assert.deepStrictEqual(d.answered, ['들여쓴 답 · 네']);
});

test('upper-case X counts as answered', () => {
  const { decisions, answerState } = require('../lib/card');
  const card = decisionCard('- [X] 큰 X 질문 · 네');
  assert.deepStrictEqual(decisions(card).answered, ['큰 X 질문 · 네']);
  assert.strictEqual(answerState(card, '큰 X 질문'), 'yes');
});

test('star and plus markers are read like dashes', () => {
  const { decisions } = require('../lib/card');
  const d = decisions(decisionCard('* [ ] 별표 질문\n+ [ ] 더하기 질문\n* [x] 별표 답 · 네'));
  assert.deepStrictEqual(d.open, ['별표 질문', '더하기 질문']);
  assert.deepStrictEqual(d.answered, ['별표 답 · 네']);
});

test('only the exact heading is read, comments dropped', () => {
  const { decisions } = require('../lib/card');
  const card = `${decisionCard('<!-- - [ ] 예시 질문 -->\n<!--\n- [ ] 여러 줄 예시\n-->\n- [ ] 진짜 질문')}## 판단 필요 메모\n- [ ] 메모 칸 질문\n`;
  assert.deepStrictEqual(decisions(card).open, ['진짜 질문']);
  assert.deepStrictEqual(decisions('# 카드\n## 판단 필요 메모\n- [ ] 메모 칸 질문\n'), { open: [], plain: [], answered: [] });
});

test('plain items are top-level non-checkbox lines', () => {
  const { decisions } = require('../lib/card');
  const d = decisions(decisionCard('- [ ] 질문\n  - 참고: 설명 줄\n- 체크 없는 항목\n* 별표 항목\n- 없음\n- (없음)\n그냥 글'));
  assert.deepStrictEqual(d.plain, ['체크 없는 항목', '별표 항목']);
  assert.deepStrictEqual(d.open, ['질문']);
});

test('answerState needs a non-empty answer', () => {
  const { answerState } = require('../lib/card');
  const card = decisionCard('- [x] 답한 질문 · 네\n- [x] 답 없는 질문\n- [x] 빈 답 질문 · \n- [ ] 열린 질문');
  assert.strictEqual(answerState(card, '답한 질문'), 'yes');
  assert.strictEqual(answerState(card, '답 없는 질문'), 'none');
  assert.strictEqual(answerState(card, '빈 답 질문'), 'none');
  assert.strictEqual(answerState(card, '열린 질문'), 'open');
  assert.strictEqual(answerState(card, '없는 질문'), 'none');
  assert.strictEqual(answerState('# 카드\n', '답한 질문'), 'none');
});
