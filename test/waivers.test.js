'use strict';

// A waiver that skips a human decision (grilling 불필요, qh confirm, the secret allow marker)
// counts only after qh showed the question to the person; the agent's words alone settle nothing.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { repo, write, sh, qh, statusJson, stopDecision, DECLARED, BASIC } = require('./helpers');
const { triage } = require('../lib/triage');

const DEVELOPER_WORDS = /\S\/|\/\S|\.json\b|\b[0-9a-f]{7,}\b|`|\bgit |qh/i;
const stop = (root) => stopDecision(qh(root, ['hook', 'stop'], '{}'));

function smallFix(config = BASIC) {
  const root = repo(config);
  write(root, 'src/a.js', '2');
  write(root, '.quality/tasks/work.md', `${DECLARED}## 의도\n\ngrilling 불필요: 오타 한 글자 수정\n`);
  qh(root, ['check']);
  return root;
}

const questionOf = (root) => triage(statusJson(root)).human[0].user;
const card = (body, extra = '') => `${DECLARED}## 의도\n\n${body}\n${extra}`;
const SMALL = 'grilling 불필요: 오타 한 글자 수정';

test('grilling 불필요 is a question for the person and counts only with a checked card line carrying that question', () => {
  const root = smallFix();
  assert.strictEqual(statusJson(root).waivers.length, 1);
  const q = questionOf(root);
  assert.strictEqual(stop(root).decision, 'block');
  assert.strictEqual(statusJson(root).waivers.length, 1, 'handing the question over is not an answer');
  write(root, '.quality/tasks/work.md', card(SMALL, `\n## 판단 필요\n- [ ] ${q}\n`));
  const open = statusJson(root);
  assert.deepStrictEqual(open.waivers, [], 'an unchecked line is the open decision instead');
  assert.deepStrictEqual(open.decisions, [q]);
  write(root, '.quality/tasks/work.md', card(SMALL, `\n## 판단 필요\n- [x] ${q} · 네 괜찮습니다\n`));
  const done = statusJson(root);
  assert.deepStrictEqual([done.waivers, done.decisions], [[], []]);
  write(root, '.quality/tasks/work.md', card(SMALL, `\n## 판단 필요\n- [x] ${q}\n`));
  assert.strictEqual(statusJson(root).waivers.length, 1, 'a checked line without an answer is not one');
});

test('a different grilling reason is a different question', () => {
  const root = smallFix();
  const q = questionOf(root);
  write(root, '.quality/tasks/work.md', card(SMALL, `\n## 판단 필요\n- [x] ${q} · 네\n`));
  assert.strictEqual(statusJson(root).waivers.length, 0);
  write(root, '.quality/tasks/work.md', card('grilling 불필요: 다른 이유로 건너뜀', `\n## 판단 필요\n- [x] ${q} · 네\n`));
  assert.strictEqual(statusJson(root).waivers.length, 1);
});

test('qh pr is blocked by an unasked waiver, and lists the waivers the agent may write by itself', () => {
  const root = smallFix({ ...BASIC, answers: { reviewer: { choice: 'C', date: '2026-11-18' } } });
  const r = qh(root, ['pr']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /grilling 불필요 선언/);
  assert.match(r.stdout, /면제한 것[\s\S]*테스트 불필요: 상수 하나만 바꿈[\s\S]*문서 영향 없음: 사용자에게 안 보임/);
});

test('a secret marked fake with the allow marker is asked about first; the agent text no longer hints the marker', () => {
  const root = repo(BASIC);
  const key = `ghp_${'a'.repeat(36)}`;
  write(root, 'src/a.test.js', `const t = '${key}' // qh:allow-secret 테스트용 가짜\n`);
  write(root, '.quality/tasks/work.md', DECLARED);
  const s = statusJson(root);
  assert.strictEqual(s.waivers.length, 1);
  assert.doesNotMatch(s.waivers[0].agent, new RegExp(key));
  const q = questionOf(root);
  write(root, 'src/a.test.js', `const t = '${key}'\n`);
  assert.doesNotMatch(statusJson(root).policy.join('\n'), /allow-secret/, 'a plain secret hint must not teach the marker');
  write(root, 'src/a.test.js', `const t = '${key}' // qh:allow-secret 테스트용 가짜\n`);
  stop(root);
  assert.strictEqual(statusJson(root).waivers.length, 1, 'shown is not answered');
  write(root, '.quality/tasks/work.md', `${DECLARED}## 판단 필요\n- [x] ${q} · 가짜가 맞습니다\n`);
  assert.deepStrictEqual(statusJson(root).waivers, []);
  write(root, 'src/a.test.js', `const t = 'ghp_${'b'.repeat(36)}' // qh:allow-secret 테스트용 가짜\n`);
  assert.strictEqual(statusJson(root).waivers.length, 1, 'an answer covers the values it was asked about, not a swapped one');
});

test('qh confirm counts only with the checked card line for the criteria question', () => {
  const root = repo(BASIC);
  sh(root, 'git', ['checkout', '-q', 'main']);
  sh(root, 'git', ['rm', '-q', '.quality/config.json']);
  sh(root, 'git', ['commit', '-qm', 'no qh yet']);
  sh(root, 'git', ['checkout', '-q', '-B', 'work']);
  write(root, '.quality/config.json', JSON.stringify(BASIC));
  assert.strictEqual(qh(root, ['confirm']).status, 0, 'the agent confirmed on its own');
  assert.strictEqual(statusJson(root).configChanges.length, 1, 'still a question');
  stop(root);
  assert.strictEqual(statusJson(root).configChanges.length, 1, 'shown is not answered');
  const q = questionOf(root);
  write(root, '.quality/tasks/work.md', `${DECLARED}## 판단 필요\n- [x] ${q} · 이대로 쓰겠습니다\n`);
  assert.deepStrictEqual(statusJson(root).configChanges, []);
  assert.match(fs.readFileSync(path.join(root, 'docs/decisions.md'), 'utf8'), /기준 확인: [0-9a-f]{12}/);
});

test('a card line with the answer is enough in CI: a fresh clone passes check --pr and status --pr, an unchecked line blocks', () => {
  const root = repo({ ...BASIC, answers: { reviewer: { choice: 'C', date: '2026-11-18' } } });
  assert.strictEqual(qh(root, ['init', root]).status, 0);
  write(root, 'src/a.js', '2');
  write(root, '.quality/tasks/work.md', card(SMALL));
  const q = questionOf(root);
  const clone = (line) => {
    write(root, '.quality/tasks/work.md', card(SMALL, `\n## 판단 필요\n${line}\n`));
    sh(root, 'git', ['add', '-A']);
    sh(root, 'git', ['commit', '-qm', 'work']);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-ci-'));
    sh(dir, 'git', ['clone', '-q', root, 'c']);
    const c = path.join(dir, 'c');
    sh(c, 'git', ['checkout', '-q', 'work']);
    sh(c, 'git', ['fetch', '-q', 'origin', 'main:main']);
    return [qh(c, ['check', '--pr']).status, qh(c, ['status', '--pr']).status];
  };
  assert.deepStrictEqual(clone(`- [x] ${q} · 네 괜찮습니다`), [0, 0]);
  assert.strictEqual(clone(`- [ ] ${q}`)[1], 1);
});

test('the person-facing sentences of the waiver questions have no paths, commands or tool names', () => {
  const root = smallFix();
  write(root, 'src/b.test.js', `const t = 'ghp_${'a'.repeat(36)}' // qh:allow-secret 가짜\n`);
  const t = triage(statusJson(root));
  assert.strictEqual(t.human.length, 2);
  for (const item of t.human) assert.doesNotMatch(item.user, DEVELOPER_WORDS, item.user);
});

test('qh pr lists a log line exempted with the pii marker, and the pii hint has no trailing space', () => {
  const root = repo({ ...BASIC, answers: { personal: { choice: 'A' }, reviewer: { choice: 'C', date: '2026-11-18' } } });
  assert.strictEqual(qh(root, ['init', root]).status, 0);
  write(root, 'src/a.js', 'console.log("signup", user.email)\n');
  write(root, '.quality/tasks/work.md', DECLARED);
  const hint = statusJson(root).policy.find((p) => p.startsWith('개인정보 로그'));
  assert.ok(hint && !/\s$/.test(hint), JSON.stringify(hint));
  write(root, 'src/a.js', 'console.log("signup", user.email) // qh:allow-pii 테스트 계정\n');
  assert.match(qh(root, ['pr']).stdout, /면제한 것[\s\S]*qh:allow-pii: src\/a\.js:1/);
});
