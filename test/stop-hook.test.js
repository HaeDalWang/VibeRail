'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { repo, write, sh, qh, stopDecision, DECLARED, BASIC } = require('./helpers');

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
  assert.match(repeat.systemMessage, /고치지 못하고 멈췄습니다[\s\S]*검사\(프로젝트 검사\)를 마지막 변경 뒤에 다시 돌리지 않았습니다/);
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
  assert.match(repeat.systemMessage, /사람이 판단할 일.*\n- 정해 주세요: 관리자는 모든 회사를 보나/);
});

// What the person sees may not need a developer to read: no paths, commands, hashes or tool names.
const DEVELOPER_WORDS = /\S\/|\/\S|\.json\b|\b[0-9a-f]{7,}\b|`|\bgit |qh/i;

test('with only environment errors, stop says it could not judge instead of "checks passed"', () => {
  const root = repo({ ...BASIC, baseRef: 'origin/main' });
  write(root, 'src/a.js', '2');
  const d = stopDecision(qh(root, ['hook', 'stop'], '{}'));
  assert.match(d.reason, /^qh: 환경 오류로 판정하지 못함/);
});

test('a branch with no common ancestor with the base is told to the person once, not passed silently', () => {
  const root = repo(BASIC);
  sh(root, 'git', ['checkout', '-q', '--orphan', 'other']);
  sh(root, 'git', ['commit', '-qm', 'other']);
  sh(root, 'git', ['checkout', '-q', 'work']);
  write(root, '.quality/config.json', JSON.stringify({ ...BASIC, baseRef: 'other' }));
  const first = stopDecision(qh(root, ['hook', 'stop'], '{}'));
  assert.ok(first?.systemMessage, 'the person hears about it');
  assert.doesNotMatch(first.systemMessage, DEVELOPER_WORDS);
  assert.strictEqual(stopDecision(qh(root, ['hook', 'stop'], '{}')), null, 'same note is not repeated');
});

test('stop hands the agent a plain sentence for the person, and shows the person only plain sentences', () => {
  const root = repo(BASIC);
  write(root, '.quality/config.json', JSON.stringify({ ...BASIC, checks: { unit: { cmd: 'true' } } }));
  write(root, '.quality/tasks/work.md', '## 판단 필요\n- [ ] 관리자는 모든 회사를 보나?\n');
  write(root, 'docs/decisions.md', '- 2026-11-16 · unit을 true로 · 예시 · 없음\n');
  qh(root, ['check']);
  const first = stopDecision(qh(root, ['hook', 'stop'], '{}'));
  assert.match(first.reason, /checks\.unit\.cmd[\s\S]*사용자에게는 이렇게 말한다: /);
  const repeat = stopDecision(qh(root, ['hook', 'stop'], '{}'));
  assert.match(repeat.systemMessage, /관리자는 모든 회사를 보나/);
  assert.doesNotMatch(repeat.systemMessage, DEVELOPER_WORDS);
});

test('a decision the agent already asked about in its last message is not asked again', () => {
  const root = repo(BASIC);
  write(root, '.quality/tasks/work.md', '## 판단 필요\n- [ ] 범위 확인\n');
  qh(root, ['check']);
  const asked = JSON.stringify({ stop_hook_active: false, last_assistant_message: '이 범위로 만들어도 될까요?' });
  const out = stopDecision(qh(root, ['hook', 'stop'], asked));
  assert.notStrictEqual(out?.decision, 'block', 'the agent asked: handing it back makes the person read the same question twice');
  assert.doesNotMatch(out?.systemMessage || '', /범위 확인/);
  const askedPolitely = JSON.stringify({ stop_hook_active: false, last_assistant_message: '고른 안과 이유를 이 창에 붙여 넣어 주세요.' });
  assert.notStrictEqual(stopDecision(qh(root, ['hook', 'stop'], askedPolitely))?.decision, 'block', 'a Korean request without "?" is still a question (seen in the sandbox run)');
  const notAsked = JSON.stringify({ stop_hook_active: false, last_assistant_message: '다 만들었습니다.' });
  assert.strictEqual(stopDecision(qh(root, ['hook', 'stop'], notAsked)).decision, 'block', 'an answer that asks nothing still gets turned back');
});
