'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { repo, write, qh, sh, statusJson, BASIC } = require('./helpers');

const PAGE = '.quality/reports/review.html';
const resultCmd = (findings) => ({ cmd: `node -e "require('fs').writeFileSync(process.argv[1]+'/result.json', process.argv[2])" {out} '${JSON.stringify(findings)}'` });

const CARD = `# 일

## 의도
할 일 목록에 <마감일> 추가

## 판단 필요
- [x] 이미 답한 질문 · 예
- [ ] 마감일 없는 일은 어디에 둘까요?

## 미확인
- 느린 컴퓨터에서 속도
`;

function reviewed({ findings = [], card = CARD, config = {}, before = () => {} } = {}) {
  const root = repo({ ...BASIC, review: resultCmd(findings), ...config });
  if (card !== null) write(root, '.quality/tasks/work.md', card);
  write(root, 'src/a.js', '2');
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', '마감일 <b>추가</b>']);
  before(root);
  const r = qh(root, ['review']);
  const file = path.join(root, PAGE);
  return { r, root, html: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null };
}

test('a finished review writes the review page and tells the agent to open it', () => {
  const { r, html } = reviewed();
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(html, 'page written');
  assert.match(r.stdout, /review\.html/);
  assert.match(r.stdout, /open/);
});

test('the page shows the five steps in reading order', () => {
  const { html } = reviewed();
  const at = ['무엇이 바뀜', '고른 안', '테스트 증거', '리뷰 지적', '남은 판단'].map((h) => html.indexOf(`<h2>${h}`));
  assert.ok(at.every((i) => i > 0), at.join(','));
  assert.deepStrictEqual([...at].sort((a, b) => a - b), at);
});

test('what changed comes from the card intent, commit subjects and changed files, escaped, with sources', () => {
  const { html } = reviewed();
  assert.match(html, /할 일 목록에 &lt;마감일&gt; 추가/);
  assert.match(html, /마감일 &lt;b&gt;추가&lt;\/b&gt;/);
  assert.match(html, /src\/a\.js/);
  assert.match(html, /출처: 작업 카드 ## 의도/);
  assert.match(html, /출처: 커밋 메시지/);
  assert.doesNotMatch(html, /<b>추가/);
});

test('findings are listed with severity, place, reason and next action; none says 지적 없음', () => {
  const f = { file: 'src/a.js', line: 1, rank: 1, severity: '높음', verdict: 'confirmed', checklist: 'x', reason: '<script>', nextAction: '고친다' };
  const { html } = reviewed({ findings: [f] });
  assert.match(html, /높음/);
  assert.match(html, /src\/a\.js:1/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /고친다/);
  assert.match(reviewed().html, /지적 없음/);
});

test('a skipped review still writes the page, saying the review was skipped', () => {
  const { r, html } = reviewed({ config: { answers: { reviewer: { choice: 'C', date: '2026-11-23' } } } });
  assert.strictEqual(r.status, 0, r.stdout);
  assert.ok(html, 'page written');
  assert.match(html, /검토 생략/);
});

test('open questions and unverified lines close the page; answered ones are left out', () => {
  const { html } = reviewed();
  const rest = html.slice(html.indexOf('<h2>남은 판단'));
  assert.match(rest, /마감일 없는 일은 어디에 둘까요\?/);
  assert.match(rest, /느린 컴퓨터에서 속도/);
  assert.doesNotMatch(rest, /이미 답한 질문/);
});

test('without a task card the page still comes out with 기록 없음', () => {
  const { r, html } = reviewed({ card: null });
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(html, /기록 없음/);
});

test('a review that breaks writes no page', () => {
  const root = repo({ ...BASIC, review: { cmd: 'node -e "process.exit(1)"' } });
  write(root, 'src/a.js', '2');
  qh(root, ['review']);
  assert.ok(!fs.existsSync(path.join(root, PAGE)));
});

const DESIGN = {
  title: 't',
  options: [
    { id: 'A', name: '한 함수', summary: 's', mermaid: 'flowchart LR\n  X --> Y', gain: '단순 <함>', cost: '읽기 어려움', signature: 'f(x)', seam: 'test/x.js' },
    { id: 'B', name: '둘로', summary: 's', mermaid: 'flowchart LR\n  P --> Q', gain: 'g', cost: 'c' },
  ],
};
const pickCard = (id, design = '.scratch/f/interface.json') => `${CARD}
## interface 결정
안: ${id} (한 함수가 모음)
이유: 단순해서 좋다
설계안: ${design}
`;

function picked(card, { level } = {}) {
  const root = repo({ ...BASIC, review: resultCmd([]), ...(level ? { answers: { level: { choice: level, date: '2026-11-23' } } } : {}) });
  write(root, '.scratch/f/interface.json', JSON.stringify(DESIGN));
  write(root, '.quality/tasks/work.md', card);
  qh(root, ['review']);
  const html = fs.readFileSync(path.join(root, PAGE), 'utf8');
  return { root, step: html.slice(html.indexOf('<h2>고른 안'), html.indexOf('<h2>테스트 증거')) };
}

test('the picked option shows the card pick and reason with its source', () => {
  const { step } = picked(pickCard('A'));
  assert.match(step, /안: A/);
  assert.match(step, /단순해서 좋다/);
  assert.match(step, /출처: 작업 카드 ## interface 결정/);
});

test('the picked option shows its picture, gain and cost from the design file', () => {
  const { root, step } = picked(pickCard('A'));
  assert.match(step, /X --&gt; Y/);
  assert.doesNotMatch(step, /P --&gt; Q/);
  assert.match(step, /단순 &lt;함&gt;/);
  assert.match(step, /읽기 어려움/);
  assert.match(step, /출처: \.scratch\/f\/interface\.json/);
  assert.ok(fs.existsSync(path.join(root, '.quality/reports/mermaid.min.js')));
});

test('a missing design file or option leaves the card text with a note', () => {
  assert.match(picked(pickCard('A', '.scratch/none.json')).step, /설계안 파일이 없다/);
  const { step } = picked(pickCard('C'));
  assert.match(step, /설계안에 C안이 없다/);
  assert.match(step, /단순해서 좋다/);
});

test('signature and seam of the picked option show only on level B', () => {
  assert.doesNotMatch(picked(pickCard('A')).step, /f\(x\)/);
  const { step } = picked(pickCard('A'), { level: 'B' });
  assert.match(step, /f\(x\)/);
  assert.match(step, /test\/x\.js/);
});

const LOG_CMD = `node -e "console.log('✔ 마감일을 저장한다 (3ms)'); console.log('  ✖ 마감일이 지나면 빨갛게 보인다 (2ms)')"`;
const CRITERIA = `${CARD}
## 성공 조건 → 검사
- 저장된다 → test/a.test.js "마감일을 저장한다"
- 지나면 빨갛다 → test/a.test.js "마감일이 지나면…"
- 정렬된다 → test/a.test.js "마감일 순으로 정렬한다"
- 손으로 확인한다
`;

function evidenced({ run = true, touch = false } = {}) {
  const root = repo({ ...BASIC, checks: { unit: { cmd: LOG_CMD } }, review: resultCmd([]) });
  write(root, '.quality/tasks/work.md', CRITERIA);
  if (run) qh(root, ['check', 'unit']);
  if (touch) write(root, 'src/a.js', '3');
  qh(root, ['review']);
  const html = fs.readFileSync(path.join(root, PAGE), 'utf8');
  return html.slice(html.indexOf('<h2>테스트 증거'), html.indexOf('<h2>리뷰 지적'));
}

const stateOfLine = (step, desc) => step.split('<li>').find((l) => l.includes(desc));

test('each success condition shows 통과, 실패 or 찾지 못함 from the last test log', () => {
  const step = evidenced();
  assert.match(stateOfLine(step, '저장된다'), /통과/);
  assert.match(stateOfLine(step, '지나면 빨갛다'), /실패/);
  assert.match(stateOfLine(step, '정렬된다'), /찾지 못함/);
  assert.match(stateOfLine(step, '손으로 확인한다'), /찾지 못함/);
  assert.match(step, /출처: \.quality\/evidence\/unit\.log/);
  assert.doesNotMatch(step, /오래된|기록이 없다/);
});

test('a test record older than the current code shows a stale warning', () => {
  assert.match(evidenced({ touch: true }), /지금 코드보다 오래된 기록/);
});

test('no test record at all shows a no-record warning', () => {
  assert.match(evidenced({ run: false }), /테스트 기록이 없다/);
});

test('a stale test record warns even when no condition matched it', () => {
  const root = repo({ ...BASIC, checks: { unit: { cmd: 'node -e "console.log(1)"' } }, review: resultCmd([]) });
  write(root, '.quality/tasks/work.md', CRITERIA);
  qh(root, ['check', 'unit']);
  write(root, 'src/a.js', '3');
  qh(root, ['review']);
  const html = fs.readFileSync(path.join(root, PAGE), 'utf8');
  assert.match(html.slice(html.indexOf('<h2>테스트 증거')), /지금 코드보다 오래된 기록/);
});

// ---------- confirmation numbers (backlog 3) ----------

const stepOf = (html, title, next) => html.slice(html.indexOf(`<h2>${title}`), next ? html.indexOf(`<h2>${next}`) : undefined);

// The design committed, the pick copied with the page's number; `edit` then changes the design file.
function confirmed(edit, extra = '') {
  const root = repo({ ...BASIC, review: resultCmd([]) });
  write(root, '.scratch/f/interface.json', JSON.stringify(DESIGN, null, 2));
  const r = qh(root, ['view', 'interface', '.scratch/f/interface.json']);
  const number = fs.readFileSync(r.stdout.match(/(\S+\.html)/)[1], 'utf8').match(/data-id="A" data-number="(\d{4})"/)[1];
  write(root, '.quality/tasks/work.md', pickCard(`A · 확인 번호 ${number}`) + extra);
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'pick']);
  if (edit) write(root, '.scratch/f/interface.json', JSON.stringify(edit, null, 2));
  qh(root, ['review']);
  const html = fs.readFileSync(path.join(root, PAGE), 'utf8');
  return { number, picked: stepOf(html, '고른 안', '테스트 증거'), left: stepOf(html, '남은 판단') };
}

test('a matching confirmation is shown as such in the picked-option step', () => {
  const { number, picked: step } = confirmed(null);
  assert.match(step, new RegExp(`확인 번호 ${number}: 고른 뒤 바뀌지 않았다`));
});

test('a pick bound by an answer line shows its number as unchanged', () => {
  const root = repo({ ...BASIC, review: resultCmd([]) });
  write(root, '.scratch/f/interface.json', JSON.stringify(DESIGN));
  write(root, '.quality/tasks/work.md', pickCard('A'));
  const user = statusJson(root).waivers.find((w) => /확인 번호/.test(w.user)).user;
  write(root, '.quality/tasks/work.md', pickCard('A').replace('- [x] 이미 답한 질문 · 예', `- [x] 이미 답한 질문 · 예\n- [x] ${user} · 네`));
  qh(root, ['review']);
  const step = stepOf(fs.readFileSync(path.join(root, PAGE), 'utf8'), '고른 안', '테스트 증거');
  assert.match(step, new RegExp(`확인 번호 ${user.match(/\d{4}/)[0]}: 고른 뒤 바뀌지 않았다`));
});

test('a changed pick shows the changed fields on the page and asks under 남은 판단', () => {
  const { number, picked: step, left } = confirmed({ ...DESIGN, options: [{ ...DESIGN.options[0], gain: '더 단순' }, DESIGN.options[1]] });
  assert.match(step, new RegExp(`고른 A안이 고른 뒤 바뀌었습니다\\(확인 번호 ${number} → \\d{4}\\)`));
  assert.match(step, /장점: 단순 &lt;함&gt; → 더 단순/);
  assert.match(left, /고른 A안이 고른 뒤 바뀌었습니다/);
});

test('an open spec confirmation shows under 남은 판단', () => {
  const extra = '명세: .scratch/f/interface.json\n\n## 루프\n.scratch/f/issues/01-a.md\n';
  const { left } = confirmed(null, extra);
  assert.match(left, /명세\(확인 번호 \d{4}\)대로 작업을 시작할까요\?/);
});

test('review groups all declared waiver reasons in one escaped section', () => {
  const reasons = ['테스트 불필요: 상수 <한 개> 변경', '문서 영향 없음: 사용자 동작은 그대로', 'ADR 불필요: 기존 설계를 그대로 사용'];
  const { html } = reviewed({ card: `${CARD}\n${reasons.join('\n')}\n` });
  const section = html.match(/<article><h2>에이전트가 작업 카드에서 면제한 것<\/h2>([\s\S]*?)<\/article>/)?.[1];
  assert.ok(section, 'waivers have one section');
  assert.match(section, /테스트 불필요: 상수 &lt;한 개&gt; 변경/);
  for (const reason of reasons.slice(1)) assert.ok(section.includes(reason));
  assert.match(section, /출처: 작업 카드/);
  assert.doesNotMatch(section, /<한 개>/);
});

test('the page shows the spec check result with the checker limit, and nothing without a record', () => {
  assert.doesNotMatch(reviewed().html, /명세 대조/);
  const { html } = reviewed({
    before: (root) => {
      write(root, '.quality/evidence/spec-check/result.json', JSON.stringify({ missing: [], extra: [{ where: 'spec', text: '정렬' }], noVisible: [] }));
      qh(root, ['spec-check', '--result']);
    },
  });
  assert.match(html, /명세 대조/);
  assert.match(html, /끼어든 말 1/);
  assert.match(html, /검사자: 에이전트 신고\(기계 확인 아님\)/);
});

test('a review done by the same-AI command says so and why on the page', () => {
  const { html } = reviewed({ config: { review: { cmd: 'exit 7', sameAiCmd: resultCmd([]).cmd } } });
  assert.match(html, /같은 AI가 봄/);
  assert.match(html, /정상 종료하지 않음/);
  assert.doesNotMatch(reviewed().html, /같은 AI가 봄/);
});
