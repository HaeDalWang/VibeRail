'use strict';

// A waiver that skips a human decision (grilling 불필요, qh confirm, the secret allow marker)
// counts only after qh showed the question to the person; the agent's words alone settle nothing.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
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

test('grilling 불필요 written by the agent alone is a question for the person, and counts once it was shown', () => {
  const root = smallFix();
  assert.strictEqual(statusJson(root).waivers.length, 1, 'not asked yet');
  const first = stop(root);
  assert.strictEqual(first.decision, 'block');
  assert.match(first.reason, /Ask the user[\s\S]*grilling 불필요/);
  assert.deepStrictEqual(statusJson(root).waivers, [], 'shown to the person: the waiver counts');
  assert.strictEqual(stop(root), null);
});

test('a different grilling reason is a different question', () => {
  const root = smallFix();
  stop(root);
  write(root, '.quality/tasks/work.md', `${DECLARED}## 의도\n\ngrilling 불필요: 다른 이유로 건너뜀\n`);
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
  write(root, 'src/a.test.js', `const t = '${key}'\n`);
  assert.doesNotMatch(statusJson(root).policy.join('\n'), /allow-secret/, 'a plain secret hint must not teach the marker');
  write(root, 'src/a.test.js', `const t = '${key}' // qh:allow-secret 테스트용 가짜\n`);
  stop(root);
  assert.deepStrictEqual(statusJson(root).waivers, []);
});

test('qh confirm counts only for a version of the criteria the person was shown', () => {
  const root = repo(BASIC);
  sh(root, 'git', ['checkout', '-q', 'main']);
  sh(root, 'git', ['rm', '-q', '.quality/config.json']);
  sh(root, 'git', ['commit', '-qm', 'no qh yet']);
  sh(root, 'git', ['checkout', '-q', '-B', 'work']);
  write(root, '.quality/config.json', JSON.stringify(BASIC));
  assert.strictEqual(qh(root, ['confirm']).status, 0, 'the agent confirmed on its own');
  assert.strictEqual(statusJson(root).configChanges.length, 1, 'still a question');
  stop(root);
  assert.deepStrictEqual(statusJson(root).configChanges, [], 'shown, so the written confirmation counts');
  assert.match(fs.readFileSync(path.join(root, 'docs/decisions.md'), 'utf8'), /기준 확인: [0-9a-f]{12}/);
});

test('the person-facing sentences of the waiver questions have no paths, commands or tool names', () => {
  const root = smallFix();
  write(root, 'src/b.test.js', `const t = 'ghp_${'a'.repeat(36)}' // qh:allow-secret 가짜\n`);
  const t = triage(statusJson(root));
  assert.strictEqual(t.human.length, 2);
  for (const item of t.human) assert.doesNotMatch(item.user, DEVELOPER_WORDS, item.user);
});
