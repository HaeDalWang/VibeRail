'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { repo, write, qh, stopDecision, DECLARED, BASIC } = require('./helpers');

test('stop blocks while a required check has no current evidence, and allows after it passes', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', '2');
  write(root, '.quality/tasks/work.md', DECLARED);
  const blocked = stopDecision(qh(root, ['hook', 'stop'], '{"stop_hook_active":true}'));
  assert.strictEqual(blocked.decision, 'block');
  assert.match(blocked.reason, /unit.*미실행/);
  qh(root, ['check']);
  assert.strictEqual(stopDecision(qh(root, ['hook', 'stop'], '{}')), null);
});

test('stop does not block again when the agent changed nothing since the last block', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', '2');
  write(root, '.quality/tasks/work.md', DECLARED);
  assert.strictEqual(stopDecision(qh(root, ['hook', 'stop'], '{"stop_hook_active":false}')).decision, 'block');
  const repeat = stopDecision(qh(root, ['hook', 'stop'], '{"stop_hook_active":true}'));
  assert.notStrictEqual(repeat?.decision, 'block', 'same tree, same items: the agent could not fix it, so stop looping');
  assert.match(repeat.systemMessage, /unit.*미실행/);
  const nextTurn = stopDecision(qh(root, ['hook', 'stop'], '{}'));
  assert.notStrictEqual(nextTurn?.decision, 'block', 'a later turn that changed nothing (or a hook input without stop_hook_active) is not blocked again');
  write(root, 'src/a.js', '3');
  assert.strictEqual(stopDecision(qh(root, ['hook', 'stop'], '{"stop_hook_active":true}')).decision, 'block', 'a new change is checked again');
});

test('stop gives up after repeated blocks on the same items even when the agent keeps changing code', () => {
  const root = repo(BASIC);
  write(root, '.quality/tasks/work.md', DECLARED);
  const blocks = [];
  for (let i = 0; i < 5; i += 1) {
    write(root, 'src/a.js', String(i));
    blocks.push(stopDecision(qh(root, ['hook', 'stop'], '{"stop_hook_active":true}'))?.decision === 'block');
  }
  assert.deepStrictEqual(blocks, [true, true, false, false, false]);
});

test('a question for the person is asked once, even without stop_hook_active in the hook input', () => {
  const root = repo(BASIC);
  write(root, '.quality/config.json', JSON.stringify({ ...BASIC, checks: { unit: { cmd: 'true' } } }));
  write(root, '.quality/tasks/work.md', '## 판단 필요\n- [ ] 관리자는 모든 회사를 보나?\n');
  write(root, 'docs/decisions.md', '- 2026-11-16 · unit을 true로 · 예시 · 없음\n');
  qh(root, ['check']);
  assert.strictEqual(stopDecision(qh(root, ['hook', 'stop'], '{}')).decision, 'block');
  const again = stopDecision(qh(root, ['hook', 'stop'], '{}'));
  assert.notStrictEqual(again?.decision, 'block', 'already asked: shown to the person, not handed back to the agent');
  assert.match(again.systemMessage, /관리자는 모든 회사를 보나/);
  write(root, '.quality/tasks/work.md', '## 판단 필요\n- [ ] 관리자는 모든 회사를 보나?\n- [ ] 탈퇴 회원 데이터는 지우나?\n');
  assert.strictEqual(stopDecision(qh(root, ['hook', 'stop'], '{}')).decision, 'block', 'a new question is asked');
});

test('stop runs built-in checks itself and blocks on their failures', () => {
  const root = repo(
    {
      baseRef: 'main',
      checks: { sql: { builtin: 'sql-prepare', migrations: 'migrations/*.sql', src: ['src/**/*.js'] } },
      common: ['sql'],
    },
    { 'migrations/001.sql': 'CREATE TABLE t (a TEXT);' },
  );
  write(root, 'src/a.js', "db.prepare('INSERT INTO t (b) VALUES (?)');");
  const d = stopDecision(qh(root, ['hook', 'stop'], '{}'));
  assert.match(d.reason, /src\/a\.js:1 .*no column named b/);
});

test('human decisions and base changes turn the agent back once, not on the repeat stop', () => {
  const root = repo(BASIC);
  write(root, '.quality/config.json', JSON.stringify({ ...BASIC, checks: { unit: { cmd: 'true' } } }));
  write(root, '.quality/tasks/work.md', '## 판단 필요\n- [ ] 관리자는 모든 회사를 보나?\n- [x] 끝난 질문\n');
  write(root, 'docs/decisions.md', '- 2026-11-16 · unit을 true로 · 예시 · 없음\n');
  qh(root, ['check']);
  const first = stopDecision(qh(root, ['hook', 'stop'], '{"stop_hook_active":false}'));
  assert.match(first.reason, /관리자는 모든 회사를 보나/);
  assert.doesNotMatch(first.reason, /끝난 질문/);
  assert.match(first.reason, /checks\.unit\.cmd/);
  const repeat = stopDecision(qh(root, ['hook', 'stop'], '{"stop_hook_active":true}'));
  assert.strictEqual(repeat.decision, undefined);
  assert.match(repeat.systemMessage, /사람이 판단할 일.*\n- 작업 카드: 관리자는 모든 회사를 보나/);
});
