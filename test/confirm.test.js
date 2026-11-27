'use strict';

// Confirmation numbers (backlog 3): the person's pick and spec approval are bound to the content
// they saw. A changed content is asked again through the same blocking list as the waivers.

const test = require('node:test');
const assert = require('node:assert');
const { repo, write, sh, qh, statusJson, stopDecision, DECLARED, BASIC } = require('./helpers');

const DESIGN = '.scratch/f/interface.json';
const OPTION_A = { id: 'A', name: '한 모듈', summary: '하나로 모은다', mermaid: 'graph TD\n  X-->Y', gain: '찾기 쉽다', cost: '파일이 는다' };
const OPTION_B = { id: 'B', name: '끼워 넣기', summary: '기존에 넣는다', mermaid: 'graph TD\n  Y-->Z', gain: '한곳', cost: '커진다' };
const design = (a = OPTION_A, b = OPTION_B) => JSON.stringify({ title: 't', options: [a, b] }, null, 2);

// The number the design page puts in the copied pick line.
function pageNumber(root, id) {
  const r = qh(root, ['view', 'interface', DESIGN]);
  return r.stdout && require('node:fs').readFileSync(r.stdout.match(/(\S+\.html)/)[1], 'utf8').match(new RegExp(`data-id="${id}" data-number="(\\d{4})"`))[1];
}

const card = (pick, answers = '') => `${DECLARED}## 의도\n\n확인 번호를 붙인다\n\n## interface 결정\n${pick}\n이유: 찾기 쉽다\n설계안: ${DESIGN}\n\n## 판단 필요\n${answers}\n`;

function picked() {
  const root = repo(BASIC, { [DESIGN]: design() });
  const number = pageNumber(root, 'A');
  write(root, '.quality/tasks/work.md', card(`안: A (한 모듈) · 확인 번호 ${number}`));
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'pick']);
  return { root, number };
}

const confirms = (root) => statusJson(root).waivers.filter((w) => /확인 번호/.test(w.user));

test('a changed pick asks again until answered, and a second change asks again', () => {
  const { root, number } = picked();
  assert.deepStrictEqual(confirms(root), [], 'the pick as copied is bound');
  write(root, DESIGN, design({ ...OPTION_A, gain: '찾기 아주 쉽다' }));
  const [q] = confirms(root);
  assert.ok(q, 'an edited picked option asks again');
  assert.match(q.user, new RegExp(`고른 A안이 고른 뒤 바뀌었습니다\\(확인 번호 ${number} → \\d{4}\\)`));
  write(root, '.quality/tasks/work.md', card(`안: A (한 모듈) · 확인 번호 ${number}`, `- [x] ${q.user} · 네`));
  assert.deepStrictEqual(confirms(root), [], 'the answered line binds the new content');
  write(root, DESIGN, design({ ...OPTION_A, gain: '또 바뀜' }));
  const again = confirms(root);
  assert.strictEqual(again.length, 1, 'a second change asks again');
  assert.ok(again[0].user.includes(`(확인 번호 ${q.user.match(/→ (\d{4})/)[1]} → `), 'from the number last approved');
});

test('whitespace edits and unpicked options ask nothing', () => {
  const { root } = picked();
  write(root, DESIGN, design({ ...OPTION_A, gain: '  찾기\n   쉽다 ', mermaid: 'graph TD\n\n      X-->Y' }, { ...OPTION_B, gain: '완전히 다름' }));
  assert.deepStrictEqual(confirms(root), []);
});

test('a pick without a number asks once', () => {
  const { root, number } = picked();
  write(root, '.quality/tasks/work.md', card('안: A (한 모듈)'));
  const [q] = confirms(root);
  assert.strictEqual(q.user, `고른 A안(확인 번호 ${number})을 지금 내용 그대로 계속 쓸까요?`);
  write(root, '.quality/tasks/work.md', card('안: A (한 모듈)', `- [x] ${q.user} · 네`));
  assert.deepStrictEqual(confirms(root), []);
});

test('a pick whose design cannot be read asks instead of passing', () => {
  const { root } = picked();
  const asked = (pick, why) => {
    write(root, '.quality/tasks/work.md', pick);
    const qs = statusJson(root).waivers.filter((w) => /고른 [A-Z]안/.test(w.user));
    assert.strictEqual(qs.length, 1, why);
    assert.match(qs[0].user, /설계안에서 찾지 못했습니다/, why);
    return qs[0];
  };
  asked(card('안: C (없는 안) · 확인 번호 0000'), 'the picked id is not in the file');
  asked(card('안: A · 확인 번호 0000').replace(`설계안: ${DESIGN}\n`, ''), 'no design link');
  const q = asked(card('안: A · 확인 번호 0000').replace(DESIGN, '.scratch/f/gone.json'), 'the file is gone');
  write(root, DESIGN, '{ broken');
  asked(card('안: A · 확인 번호 0000'), 'the file is not JSON');
  write(root, '.quality/tasks/work.md', card('안: A · 확인 번호 0000', `- [x] ${q.user} · 네`).replace(DESIGN, '.scratch/f/gone.json'));
  assert.deepStrictEqual(statusJson(root).waivers.filter((w) => /고른 [A-Z]안/.test(w.user)), [], 'a yes settles it');
});

test('only a yes approves: a no stops and tells the agent to fix it', () => {
  const { root, number } = picked();
  write(root, DESIGN, design({ ...OPTION_A, gain: '찾기 아주 쉽다' }));
  const [q] = confirms(root);
  for (const no of ['아니요', '아니요, 예전 안으로 돌려 주세요', '잠깐만요', '진행하지 마세요', 'ㅇ', 'ㅇㅇㅇ', 'ㅇㅇ아님']) {
    write(root, '.quality/tasks/work.md', card(`안: A (한 모듈) · 확인 번호 ${number}`, `- [x] ${q.user} · ${no}`));
    const [still] = confirms(root);
    assert.ok(still, `"${no}" is not an approval`);
    assert.match(still.agent, new RegExp(`사용자가 "${no}"라고 답했다`));
  }
  for (const yes of ['예', '네, 계속하세요', '진행해', '돌려', 'ㅇㅇ', 'ㅇㅇ 진행', 'ㅇㅋ']) {
    write(root, '.quality/tasks/work.md', card(`안: A (한 모듈) · 확인 번호 ${number}`, `- [x] ${q.user} · ${yes}`));
    assert.deepStrictEqual(confirms(root), [], `"${yes}" approves`);
  }
});

test('a confirmation question blocks the stop hook', () => {
  const { root } = picked();
  write(root, DESIGN, design({ ...OPTION_A, cost: '파일이 두 개 는다' }));
  const r = stopDecision(qh(root, ['hook', 'stop'], '{}'));
  assert.strictEqual(r.decision, 'block');
  assert.match(r.reason, /고른 A안이 고른 뒤 바뀌었습니다/);
});

test('changed fields come from the committed old version', () => {
  const { root } = picked();
  write(root, DESIGN, design({ ...OPTION_A, gain: '찾기 아주 쉽다', mermaid: 'graph TD\n  X-->Z' }));
  const [q] = confirms(root);
  assert.deepStrictEqual(q.changes, { kind: 'option', fields: [
    { label: '그림', old: 'graph TD X-->Y', now: 'graph TD X-->Z' },
    { label: '장점', old: '찾기 쉽다', now: '찾기 아주 쉽다' },
  ] });
  assert.match(q.agent, /장점: 찾기 쉽다 → 찾기 아주 쉽다/);
});

test('an uncommitted old version gives the plain note', () => {
  const root = repo(BASIC, { [DESIGN]: design() });
  write(root, DESIGN, design({ ...OPTION_A, gain: '커밋 안 된 판' }));
  const number = pageNumber(root, 'A');
  write(root, '.quality/tasks/work.md', card(`안: A · 확인 번호 ${number}`));
  write(root, DESIGN, design({ ...OPTION_A, gain: '또 다른 판' }));
  const [q] = confirms(root);
  assert.strictEqual(q.changes, null);
  assert.match(q.user, /예전 내용을 찾지 못했습니다\. 지금 내용 전체를 다시 보세요/);
});

// ---------- the spec ----------

const SPEC = '.scratch/f/spec.md';
const SPEC_TEXT = '# Spec\n\n## Solution\n\nOne module owns the number.\n\n## Out of Scope\n\nAnnotations.\n';
const specCard = (loop, answers = '') => `${DECLARED}## 의도\n\n확인 번호\n\n## interface 결정\n명세: ${SPEC}\n\n## 루프\n${loop}\n\n## 판단 필요\n${answers}\n`;
const LOOP = '.scratch/f/issues/01-a.md';

function specRepo() {
  const root = repo(BASIC, { [SPEC]: SPEC_TEXT });
  write(root, '.quality/tasks/work.md', specCard(''));
  return root;
}

test('the spec is asked once the loop lists tickets', () => {
  const root = specRepo();
  assert.deepStrictEqual(confirms(root), [], 'no loop paths yet');
  write(root, '.quality/tasks/work.md', specCard(LOOP));
  checkResult(root, {});
  const [q] = confirms(root);
  assert.match(q.user, /^명세\(확인 번호 \d{4}\)대로 작업을 시작할까요\?$/);
  write(root, '.quality/tasks/work.md', specCard(LOOP, `- [x] ${q.user} · 돌려`));
  assert.deepStrictEqual(confirms(root), [], '"돌려" binds the spec');
  write(root, SPEC, SPEC_TEXT.replace('One module', '  One   module').replace(/\n\n/g, '\n\n\n'));
  assert.deepStrictEqual(confirms(root), [], 'whitespace edits ask nothing');
  write(root, '.quality/tasks/work.md', specCard(LOOP).replace(SPEC, '.scratch/f/gone.md'));
  assert.ok(statusJson(root).waivers.some((w) => /^명세를 찾지 못했습니다/.test(w.user)), 'a missing spec asks');
  write(root, '.quality/tasks/work.md', specCard(LOOP).replace(`명세: ${SPEC}\n`, ''));
  assert.deepStrictEqual(confirms(root), [], 'no spec link asks nothing');
});

test('a changed spec asks again with the changed lines', () => {
  const root = specRepo();
  write(root, '.quality/tasks/work.md', specCard(LOOP));
  checkResult(root, {});
  const [start] = confirms(root);
  write(root, '.quality/tasks/work.md', specCard(LOOP, `- [x] ${start.user} · 돌려`));
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'loop start']);
  write(root, SPEC, SPEC_TEXT.replace('Annotations.', 'Annotations and tickets.'));
  const [q] = confirms(root);
  assert.match(q.user, new RegExp(`^명세가 확인한 뒤 바뀌었습니다\\(확인 번호 ${start.user.match(/\d{4}/)[0]} → \\d{4}\\)`));
  assert.deepStrictEqual(q.changes, { kind: 'spec', lines: ['-Annotations.', '+Annotations and tickets.'] });
  assert.match(q.agent, /\+Annotations and tickets\./);

  write(root, SPEC, SPEC_TEXT.replace('Annotations.', '커밋 안 한 판'));
  const [mid] = confirms(root);
  write(root, '.quality/tasks/work.md', specCard(LOOP, `- [x] ${start.user} · 돌려\n- [x] ${mid.user} · 네`));
  write(root, SPEC, SPEC_TEXT.replace('Annotations.', '또 다른 판'));
  const [lost] = confirms(root);
  assert.strictEqual(lost.changes, null, 'the approved version was never committed');
  assert.match(lost.user, /예전 내용을 찾지 못했습니다/);
});

test('an open line for the question is a decision, not a second question', () => {
  const { root, number } = picked();
  write(root, DESIGN, design({ ...OPTION_A, gain: '바뀜' }));
  const [q] = confirms(root);
  write(root, '.quality/tasks/work.md', card(`안: A · 확인 번호 ${number}`, `- [ ] ${q.user}`));
  const s = statusJson(root);
  assert.deepStrictEqual(s.waivers.filter((w) => /확인 번호/.test(w.user)), []);
  assert.ok(s.decisions.includes(q.user), 'the open line blocks as an open decision');
});

test('a fresh pick after an earlier answer is bound', () => {
  const { root, number } = picked();
  write(root, DESIGN, design({ ...OPTION_A, gain: '바뀜' }));
  const [q] = confirms(root);
  write(root, DESIGN, design({ ...OPTION_A, gain: '다시 고를 판' }));
  const fresh = pageNumber(root, 'A');
  write(root, '.quality/tasks/work.md', card(`안: A · 확인 번호 ${fresh}`, `- [x] ${q.user} · 네`));
  assert.notStrictEqual(fresh, number);
  assert.deepStrictEqual(confirms(root), []);
});

// Ticket shape (명세 대조 rules): problems with the tickets a card links show in the normal check.
const TK = (n, { blocked = 'None (can start immediately)', box = '- [ ] it works' } = {}) => `# ${n}: t\n\n**Blocked by:** ${blocked}\n\n**Status:** ready-for-agent\n\n${box}\n`;
function ticketed(tickets) {
  const rels = Object.keys(tickets);
  const root = repo(BASIC, { '.scratch/f/spec.md': '# Spec\n' });
  for (const [rel, body] of Object.entries(tickets)) if (body !== null) write(root, rel, body);
  write(root, '.quality/tasks/work.md', `${DECLARED}## 의도\n\nx\n\n## interface 결정\n안: A\n이유: 쉽다\n명세: .scratch/f/spec.md\n작업: ${rels.join(' ')}\n\n## 판단 필요\n`);
  return root;
}
const shape = (root) => statusJson(root).policy.filter((p) => /작업 파일/.test(p));

test('ticket shape problems show in the normal check, naming the ticket', () => {
  const T1 = '.scratch/f/issues/01-a.md';
  const T2 = '.scratch/f/issues/02-b.md';
  assert.deepStrictEqual(shape(ticketed({ [T1]: TK('01'), [T2]: TK('02', { blocked: '01' }) })), [], 'well-formed tickets show nothing');
  const noBox = shape(ticketed({ [T1]: TK('01', { box: '' }) }));
  assert.strictEqual(noBox.length, 1);
  assert.match(noBox[0], /01-a\.md.*완료 조건/);
  const badBlocker = shape(ticketed({ [T1]: TK('01'), [T2]: TK('02', { blocked: '01, 05' }) }));
  assert.strictEqual(badBlocker.length, 1);
  assert.match(badBlocker[0], /02-b\.md.*05/);
  const gone = shape(ticketed({ [T1]: TK('01'), [T2]: null }));
  assert.strictEqual(gone.length, 1);
  assert.match(gone[0], /02-b\.md.*없/);
});

test('a card with no linked tickets shows no ticket shape problem', () => {
  const root = repo(BASIC);
  write(root, '.quality/tasks/work.md', `${DECLARED}## 의도\n\nx\n`);
  assert.deepStrictEqual(shape(root), []);
});

// The spec check gate (명세 대조): "돌려" is asked only after the check passed for the current content.
const G1 = '.scratch/f/issues/01-a.md';
const gateCard = (answers = '') => `${DECLARED}## 의도\n\n할 일을 지운다\n\n## interface 결정\n명세: ${SPEC}\n작업: ${G1}\n\n## 루프\n${G1}\n\n## 판단 필요\n${answers}\n`;
function gated(answers) {
  const root = repo(BASIC, { [SPEC]: SPEC_TEXT });
  write(root, G1, TK('01'));
  write(root, '.quality/tasks/work.md', gateCard(answers));
  return root;
}
const checkResult = (root, result) => {
  write(root, '.quality/evidence/spec-check/result.json', JSON.stringify({ missing: [], extra: [], noVisible: [], ...result }));
  const r = qh(root, ['spec-check', '--result']);
  assert.strictEqual(r.status, 0, r.stdout);
};
const gateOf = (root) => {
  const s = statusJson(root);
  return { agent: s.policy.filter((p) => /명세 대조/.test(p)), start: s.waivers.filter((w) => /^명세\(확인 번호/.test(w.user)), asked: s.waivers.filter((w) => /명세·작업에 없습니다|끝나도 확인할 것이 없습니다|들어갔습니다/.test(w.user)).map((w) => w.user) };
};

test('with tickets and no spec check record, the agent is told to run it and "돌려" is not asked', () => {
  const g = gateOf(gated());
  assert.strictEqual(g.agent.length, 1, 'one agent item');
  assert.deepStrictEqual(g.start, [], 'no spec confirmation before the check');
});

test('a pass for the current content brings "돌려"; changed content brings the check back', () => {
  const root = gated();
  checkResult(root, {});
  let g = gateOf(root);
  assert.deepStrictEqual(g.agent, []);
  assert.strictEqual(g.start.length, 1, 'the spec confirmation is asked');
  write(root, G1, TK('01', { box: '- [x] it works' }).replace('ready-for-agent', 'ready-for-human'));
  assert.deepStrictEqual(gateOf(root).agent, [], 'ticking a box or setting the status is not a content change');
  write(root, G1, TK('01', { box: '- [ ] it works\n- [ ] it also sorts' }));
  g = gateOf(root);
  assert.strictEqual(g.agent.length, 1, 'a changed ticket needs the check again');
  assert.deepStrictEqual(g.start, []);
});

test('an unrequested item is asked once; yes settles it on rerun, another answer tells the agent to remove it', () => {
  const root = gated();
  checkResult(root, { extra: [{ where: 'spec', text: '정렬' }] });
  const g = gateOf(root);
  assert.deepStrictEqual(g.asked, ["명세에 '정렬'가 들어갔습니다. 원하신 건가요?"]);
  assert.deepStrictEqual(g.start, [], 'not before it is answered');
  write(root, '.quality/tasks/work.md', gateCard(`- [x] ${g.asked[0]} · 네`));
  checkResult(root, { extra: [{ where: 'spec', text: '정렬' }] });
  assert.deepStrictEqual(gateOf(root).asked, [], 'the answer survives a rerun');
  assert.strictEqual(gateOf(root).start.length, 1);
  write(root, '.quality/tasks/work.md', gateCard(`- [x] ${g.asked[0]} · 아니요 빼 주세요`));
  const no = gateOf(root);
  assert.deepStrictEqual(no.asked, []);
  assert.strictEqual(no.agent.length, 1);
  assert.match(no.agent[0], /아니요 빼 주세요.*빼고/);
});

test('missing items and tickets with nothing to see are the agent\'s for 2 rounds, then the person\'s', () => {
  const root = gated();
  const gap = { missing: [{ from: '의도', text: '지우기' }], noVisible: [{ ticket: G1, text: '볼 것 없음' }] };
  checkResult(root, gap);
  let g = gateOf(root);
  assert.strictEqual(g.agent.length, 1, 'round 1: the agent fixes');
  assert.deepStrictEqual(g.asked, []);
  write(root, SPEC, `${SPEC_TEXT}\nround 2\n`);
  checkResult(root, gap);
  g = gateOf(root);
  assert.deepStrictEqual(g.agent, []);
  assert.deepStrictEqual(g.asked, ["작업 카드의 '지우기'가 명세·작업에 없습니다. 빼고 진행할까요?", "작업 '01'은 끝나도 확인할 것이 없습니다. 그대로 진행할까요?"]);
  assert.deepStrictEqual(g.start, []);
});

test('a card with no linked tickets gets no spec check item', () => {
  const root = repo(BASIC, { [SPEC]: SPEC_TEXT });
  write(root, '.quality/tasks/work.md', `${DECLARED}## 의도\n\nx\n\n## interface 결정\n명세: ${SPEC}\n\n## 판단 필요\n`);
  assert.deepStrictEqual(gateOf(root), { agent: [], start: [], asked: [] });
});
