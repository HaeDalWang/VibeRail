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

test('no design link, file or option asks nothing', () => {
  const { root } = picked();
  write(root, '.quality/tasks/work.md', card('안: C (없는 안) · 확인 번호 0000'));
  assert.deepStrictEqual(confirms(root), [], 'the picked id is not in the file');
  write(root, '.quality/tasks/work.md', card('안: A · 확인 번호 0000').replace(`설계안: ${DESIGN}\n`, ''));
  assert.deepStrictEqual(confirms(root), [], 'no design link');
  write(root, '.quality/tasks/work.md', card('안: A · 확인 번호 0000').replace(DESIGN, '.scratch/f/gone.json'));
  assert.deepStrictEqual(confirms(root), [], 'the file is gone');
});

test('a confirmation question blocks the stop hook', () => {
  const { root } = picked();
  write(root, DESIGN, design({ ...OPTION_A, cost: '파일이 두 개 는다' }));
  const r = stopDecision(qh(root, ['hook', 'stop'], '{}'));
  assert.strictEqual(r.decision, 'block');
  assert.match(r.reason, /고른 A안이 고른 뒤 바뀌었습니다/);
});
