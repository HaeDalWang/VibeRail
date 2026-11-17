'use strict';

// qh-cycle rules: the card's 의도 / interface 결정 / 테스트 위치(seam) sections drive what
// Stop blocks, the glossary warns about new domain names, and SessionStart says where the
// card stands.

const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const { repo, write, sh, qh, statusJson, DECLARED, BASIC } = require('./helpers');

const policyOf = (root) => statusJson(root).policy.join('\n');
const card = (root, body) => write(root, '.quality/tasks/work.md', body);
const GRILLED = '## 의도\n로그인 화면을 만든다. 범위는 이메일 입력까지.\n';

test('D20: code changed with an empty 의도 section and no grilling declaration is blocked', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', '2');
  card(root, `${DECLARED}## 의도\n\n## 판단 필요\n- 없음\n`);
  assert.match(policyOf(root), /의도: 코드가 바뀌었는데[^\n]*`## 의도`[^\n]*`grilling 불필요: <[^>]*5자 이상>`/);
  card(root, `${DECLARED}${GRILLED}`);
  assert.doesNotMatch(policyOf(root), /의도:/);
  card(root, `${DECLARED}## 의도\n\ngrilling 불필요: 오타 한 글자 수정\n`);
  assert.doesNotMatch(policyOf(root), /의도:/);
  card(root, `${DECLARED}## 의도\n\ngrilling 불필요: 짧음\n`);
  assert.match(policyOf(root), /의도:[^\n]*5자 이상/, 'a reason too short does not count');
});

test('D20 ruling: a card without a 의도 heading (or no card) behaves as before', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', '2');
  card(root, DECLARED);
  assert.doesNotMatch(policyOf(root), /의도:/);
  assert.doesNotMatch(statusJson(root).policy.join('\n'), /의도/);
});

test('D20: the person hears it in plain words', () => {
  const { aiFixUser } = require('../lib/triage');
  const s = aiFixUser('의도: 코드가 바뀌었는데 .quality/tasks/work.md의 `## 의도`가 비어 있다 → …', BASIC);
  assert.match(s, /무엇을 왜 만드는지/);
  assert.doesNotMatch(s, /\S\/|`|qh|grilling/);
  assert.match(aiFixUser('interface 결정: 이유가 없다', BASIC), /이유/);
});

test('D6: an interface choice needs a real reason line', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', '2');
  card(root, `${DECLARED}${GRILLED}## interface 결정\n옵션 B: 주문 객체 하나로 묶기\n`);
  assert.match(policyOf(root), /interface 결정: [^\n]*이유: <[^>]*5자 이상>/);
  card(root, `${DECLARED}${GRILLED}## interface 결정\n옵션 B\n이유: 짧음\n`);
  assert.match(policyOf(root), /interface 결정:/, 'four characters do not count');
  card(root, `${DECLARED}${GRILLED}## interface 결정\n옵션 B\n이유: <5자 이상>\n`);
  assert.match(policyOf(root), /interface 결정:/, 'the pasted placeholder does not count');
  card(root, `${DECLARED}${GRILLED}## interface 결정\n옵션 B\n- 이유: 호출하는 쪽이 한 번만 알면 돼서\n`);
  assert.doesNotMatch(policyOf(root), /interface 결정:/);
  card(root, `${DECLARED}${GRILLED}## interface 결정\n안: B\n이유: 호출이 단순해서\n`);
  assert.doesNotMatch(policyOf(root), /interface 결정:/, 'the text the view copies passes as pasted');
  card(root, `${DECLARED}${GRILLED}## interface 결정\n\n## 판단 필요\n- 없음\n`);
  assert.doesNotMatch(policyOf(root), /interface 결정:/, 'an empty section asks for nothing');
});

test('D6: an architecture pick added to the decision log needs a reason too', () => {
  const root = repo(BASIC);
  write(root, 'docs/decisions.md', '- 2026-11-01 · 아키텍처 점검: 2026-11-01 · 주문 모듈 · 짧\n');
  card(root, `${DECLARED}${GRILLED}`);
  write(root, 'src/a.js', '2');
  assert.match(policyOf(root), /아키텍처 점검: [^\n]*이유/);
  write(root, 'docs/decisions.md', '- 2026-11-01 · 아키텍처 점검: 2026-11-01 · 주문 모듈 · 호출 경로가 세 겹이라서\n');
  assert.doesNotMatch(policyOf(root), /아키텍처 점검:/);
});

test('D19-b: with seams in the card, TDD is judged at the seam paths', () => {
  const root = repo(BASIC, { 'package.json': '{}', 'src/orders/index.js': '1', 'test/orders.test.js': '1', 'test/other.test.js': '1' });
  card(root, `${GRILLED}## 테스트 위치(seam)\n- src/orders\n\n## 판단 필요\n- 없음\n문서 영향 없음: 사용자에게 안 보임\n`);
  write(root, 'src/orders/index.js', '2');
  write(root, 'test/other.test.js', '2');
  assert.match(policyOf(root), /TDD: [^\n]*seam/, 'a test elsewhere in the package is not the seam');
  write(root, 'test/orders.test.js', '2');
  assert.doesNotMatch(policyOf(root), /TDD/, 'a test named for the seam satisfies it');
});

test('D19-b: a test under the seam folder satisfies it; no seam section keeps the package rule', () => {
  const root = repo(BASIC, { 'package.json': '{}', 'src/orders/index.js': '1', 'src/orders/orders.spec.js': '1', 'test/other.test.js': '1' });
  card(root, `${GRILLED}## 테스트 위치(seam)\n\`src/orders/\`\n\n문서 영향 없음: 사용자에게 안 보임\n`);
  write(root, 'src/orders/index.js', '2');
  write(root, 'src/orders/orders.spec.js', '2');
  assert.doesNotMatch(policyOf(root), /TDD/);
  card(root, `${GRILLED}문서 영향 없음: 사용자에게 안 보임\n`);
  write(root, 'src/orders/orders.spec.js', '1');
  write(root, 'test/other.test.js', '2');
  assert.doesNotMatch(policyOf(root), /TDD/, 'same package, a test changed: the old rule passes');
  write(root, 'test/other.test.js', '1');
  assert.match(policyOf(root), /TDD/);
});

test('D21: a new type name missing from GLOSSARY.md is a warning, never a block', () => {
  const root = repo(BASIC, { 'GLOSSARY.md': '# 용어\n\n## Language\n\n**Order**:\n주문.\n' });
  card(root, `${DECLARED}${GRILLED}`);
  write(root, 'src/a.js', 'class Order {}\nclass Shipment {}\nclass shipmentHelper {}\n');
  const s = statusJson(root);
  assert.deepStrictEqual(s.policy, []);
  assert.strictEqual(s.policyWarnings.length, 1);
  assert.match(s.policyWarnings[0], /Shipment/);
  assert.doesNotMatch(s.policyWarnings[0], /Order/);
  assert.match(qh(root, ['status']).stdout, /경고 \(막지 않음\)[\s\S]*Shipment/);
});

test('D21: no GLOSSARY.md means no warning; a name already in the file is quiet', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', 'class Shipment {}\n');
  assert.deepStrictEqual(statusJson(root).policyWarnings, []);
  write(root, 'GLOSSARY.md', '**Shipment**: 출고.\n');
  assert.deepStrictEqual(statusJson(root).policyWarnings, []);
});

test('GLOSSARY.md and GLOSSARY-MAP.md at the top need no root-file reason', () => {
  const root = repo(BASIC);
  card(root, DECLARED);
  write(root, 'GLOSSARY.md', '# 용어\n');
  write(root, 'GLOSSARY-MAP.md', '# 지도\n');
  write(root, 'NOTES.md', '# x\n');
  const structure = statusJson(root).structure.join('\n');
  assert.doesNotMatch(structure, /GLOSSARY/);
  assert.match(structure, /루트 파일: [^\n]*NOTES\.md/);
});

// ---------- stage line and architecture check ----------

const CYCLE_HEADINGS = '## 의도\n\n## interface 결정\n\n## 테스트 위치(seam)\n';
const stage = (root) => qh(root, ['cycle']).stdout;
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

test('the stage is the first missing of 의도, interface 결정, 테스트 위치, then done', () => {
  const root = repo(BASIC);
  card(root, CYCLE_HEADINGS);
  assert.match(stage(root), /단계: 의도[^\n]*다음 결정 ◆/);
  card(root, `${GRILLED}## interface 결정\n\n## 테스트 위치(seam)\n`);
  assert.match(stage(root), /단계: interface 결정/);
  card(root, `${GRILLED}## interface 결정\n옵션 A\n\n## 테스트 위치(seam)\n`);
  assert.match(stage(root), /단계: interface 결정/, 'a choice without its reason is still this stage');
  card(root, `${GRILLED}## interface 결정\n옵션 A\n이유: 호출이 단순해서\n\n## 테스트 위치(seam)\n`);
  assert.match(stage(root), /단계: 테스트 위치/);
  card(root, `${GRILLED}## interface 결정\n옵션 A\n이유: 호출이 단순해서\n\n## 테스트 위치(seam)\nsrc/orders\n`);
  assert.match(stage(root), /단계: 완료/);
  card(root, '## 의도\ngrilling 불필요: 오타 수정\n');
  assert.match(stage(root), /단계: 완료/, 'a declared small fix skips the cycle');
  assert.strictEqual(stage(root).split('\n').filter(Boolean).length, 1, 'one line');
});

test('SessionStart shows the stage in a qh-cycle project and stays quiet elsewhere', () => {
  const root = repo(BASIC);
  assert.doesNotMatch(qh(root, ['hook', 'session-start']).stdout, /카드 단계/);
  card(root, CYCLE_HEADINGS);
  assert.match(qh(root, ['hook', 'session-start']).stdout, /\(qh\) 카드 단계: 의도/);
});

function commitCard(root, name, when) {
  write(root, `.quality/tasks/${name}.md`, '# x\n');
  sh(root, 'git', ['add', '-A']);
  const at = `${when}T12:00:00 +0000`;
  const r = spawnSync('git', ['commit', '-qm', name], { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } });
  assert.strictEqual(r.status, 0, String(r.stderr));
}

test('architecture check is due after 3 cards since the last 아키텍처 점검 line', () => {
  const root = repo(BASIC, { 'docs/decisions.md': `- ${day(-5)} · 아키텍처 점검: ${day(-5)} · 주문 모듈 · 호출 경로가 세 겹이라서\n` });
  sh(root, 'git', ['checkout', '-q', 'main']);
  sh(root, 'git', ['merge', '-q', 'work']);
  commitCard(root, 'a', day(-3));
  commitCard(root, 'b', day(-2));
  assert.doesNotMatch(stage(root), /아키텍처 점검 시기/);
  commitCard(root, 'c', day(-1));
  assert.match(stage(root), /아키텍처 점검 시기[^\n]*카드 3개/);
});

test('architecture check is due after 7 days; with no line it counts from the first card', () => {
  const root = repo(BASIC, { 'docs/decisions.md': `- ${day(-10)} · 아키텍처 점검: ${day(-10)} · 주문 모듈 · 호출 경로가 세 겹이라서\n` });
  assert.doesNotMatch(stage(root), /아키텍처 점검 시기/, 'no card since the check: nothing to check');
  commitCard(root, 'a', day(-1));
  assert.match(stage(root), /아키텍처 점검 시기[^\n]*10일/);
  const fresh = repo(BASIC);
  commitCard(fresh, 'a', day(-8));
  assert.match(stage(fresh), /아키텍처 점검 시기[^\n]*8일/);
  const young = repo(BASIC);
  commitCard(young, 'a', day(-2));
  assert.doesNotMatch(stage(young), /아키텍처 점검 시기/);
});

// ---------- defaults with no outside basis: config `limits` can change them ----------

test('config limits change the architecture cadence, the reason length and the copy window', () => {
  const root = repo({ ...BASIC, limits: { architectureCards: 1, architectureDays: 30, reasonChars: 12, duplicateLines: 8 } });
  commitCard(root, 'a', day(-1));
  assert.match(stage(root), /아키텍처 점검 시기[^\n]*카드 1개/, 'one card is enough when the project says so');
  write(root, 'src/a.js', '2');
  card(root, DECLARED);
  assert.match(policyOf(root), /TDD:.*이유는 12자 이상/, '"상수 하나만 바꿈" is under 12 characters');
  const six = Array.from({ length: 6 }, (_, i) => `const value${i} = compute(${i}, options.flag);`).join('\n');
  write(root, 'src/one.js', `${six}\n`);
  write(root, 'src/two.js', `${six}\n`);
  assert.doesNotMatch(statusJson(root).structure.join('\n'), /중복/, 'six same lines are under an eight-line window');
  const plain = repo(BASIC);
  write(plain, 'src/one.js', `${six}\n`);
  write(plain, 'src/two.js', `${six}\n`);
  assert.match(statusJson(plain).structure.join('\n'), /중복/, 'the default window is six lines');
});

// ---------- loop stage: tickets written by to-tickets, run in rounds of at most 3 ----------

const SEAMED = `${GRILLED}## interface 결정\n옵션 A\n이유: 호출이 단순해서\n\n## 테스트 위치(seam)\nsrc/orders\n`;
const T1 = '.scratch/orders/issues/01-x.md';
const T2 = '.scratch/orders/issues/02-y.md';
const T3 = '.scratch/orders/issues/03-z.md';
const T4 = '.scratch/orders/issues/04-w.md';
const ticket = (root, rel, boxes, status = 'ready-for-agent') => write(root, rel, `# t\n\n**Status:** ${status}\n\n${boxes.map((b) => `- [${b}] 기준`).join('\n')}\n`);
const loopCard = (root, tickets, round = tickets) => card(root, `${SEAMED}\n## 티켓\n${tickets.join('\n')}\n\n## 루프\n${round.join('\n')}\n`);

test('loop: a card with no ticket paths stays at 완료 as before', () => {
  const root = repo(BASIC);
  card(root, SEAMED);
  assert.match(stage(root), /단계: 완료 · 다음 결정 ◆ 완료 리뷰/);
});

test('loop: tickets referenced but no 루프 section asks to start the loop', () => {
  const root = repo(BASIC);
  ticket(root, T1, [' ']);
  card(root, `${SEAMED}\n링크: ${T1}\n`);
  assert.match(stage(root), /단계: 루프 · 다음 결정 ◆ 루프 시작 \(이번에 돌릴 티켓 최대 3개와 사람 몫 티켓을 보고 "돌려"\)/);
  card(root, `${SEAMED}\n링크: ${T1}\n\n## 루프\n\n`);
  assert.match(stage(root), /단계: 루프 · 다음 결정 ◆ 루프 시작/, 'an empty 루프 section is the same');
});

test('loop: progress n/N counts tickets with ticked boxes and none open', () => {
  const root = repo(BASIC);
  ticket(root, T1, ['x', 'x']);
  ticket(root, T2, ['x', ' ']);
  loopCard(root, [T1, T2]);
  const out = stage(root);
  assert.match(out, /카드 단계: 루프 진행 1\/2 · 다음 결정 ◆ 완료 리뷰 \(루프가 끝나거나 멈추면\)/);
  assert.strictEqual(out.split('\n').filter(Boolean).length, 1, 'one line');
});

test('loop: all done with one other ticket still open is 완료 and names the remainder', () => {
  const root = repo(BASIC);
  ticket(root, T1, ['x']);
  ticket(root, T2, ['x']);
  ticket(root, T3, [' ']);
  loopCard(root, [T1, T2, T3], [T1, T2]);
  const out = stage(root);
  assert.match(out, /단계: 완료 · 다음 결정 ◆ 완료 리뷰[^\n]*· 남은 티켓 1개는 리뷰 뒤 다음 루프로 다시 정함/);
  ticket(root, T3, ['x']);
  assert.doesNotMatch(stage(root), /남은 티켓/);
});

test('loop: a round over the cap of 3 gets its own line', () => {
  const root = repo(BASIC);
  for (const t of [T1, T2, T3, T4]) ticket(root, t, [' ']);
  loopCard(root, [T1, T2, T3, T4]);
  const lines = stage(root).split('\n').filter(Boolean);
  assert.match(lines[0], /루프 진행 0\/4/);
  assert.match(lines.join('\n'), /루프: 이번 묶음이 4개라 한도 3개를 넘었다[^\n]*3개로 줄/);
  loopCard(root, [T1, T2, T3]);
  assert.doesNotMatch(stage(root), /한도/);
});

test('loop: a listed ticket marked ready-for-human must leave the loop', () => {
  const root = repo(BASIC);
  ticket(root, T1, [' ']);
  ticket(root, T2, [' '], 'ready-for-human');
  loopCard(root, [T1, T2]);
  assert.match(stage(root), /루프: 사람 몫 티켓[^\n]*02-y\.md[^\n]*루프에서 빼/);
  loopCard(root, [T1]);
  assert.doesNotMatch(stage(root), /사람 몫/);
});

test('loop: SessionStart shows the loop progress line', () => {
  const root = repo(BASIC);
  ticket(root, T1, ['x']);
  ticket(root, T2, [' ']);
  loopCard(root, [T1, T2]);
  assert.match(qh(root, ['hook', 'session-start']).stdout, /\(qh\) 카드 단계: 루프 진행 1\/2/);
});
