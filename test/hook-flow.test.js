'use strict';

// The Stop hook over several turns and hosts: what is handed to the agent, what reaches
// the person, and how often. Kiro sends no stop_hook_active and calls Stop once per turn.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { repo, write, sh, qh, stopDecision, statusJson, DECLARED, BASIC } = require('./helpers');

// Words a non-developer cannot read: paths, commands, hashes, tool and check names.
const DEVELOPER_WORDS = /\S\/|\/\S|\.json\b|\b[0-9a-f]{7,}\b|`|\bgit |qh|\bTDD\b|\bADR\b|\b(test|sql|routes|access|unit|lint|auth|db|external)\b|test-work/i;
const NO_CHECKS = { baseRef: 'main', checks: {}, common: [] };
const CLAUDE = '{"stop_hook_active":true}';
const kiro = (session = 'k1') => JSON.stringify({ session_id: session, hook_event_name: 'Stop', cwd: '/x' });

test('when the agent gives up, the person hears plain words once, not every turn', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', '2');
  assert.strictEqual(stopDecision(qh(root, ['hook', 'stop'], CLAUDE)).decision, 'block');
  const stuck = stopDecision(qh(root, ['hook', 'stop'], CLAUDE));
  assert.notStrictEqual(stuck?.decision, 'block');
  assert.match(stuck.systemMessage, /고치지 못하고 멈췄습니다/);
  assert.match(stuck.systemMessage, /테스트/);
  assert.doesNotMatch(stuck.systemMessage, DEVELOPER_WORDS, stuck.systemMessage);
  assert.strictEqual(stopDecision(qh(root, ['hook', 'stop'], CLAUDE)), null, 'the same note is not repeated');
});

test('an item is blocked at most twice in a row even when other items come and go', () => {
  const root = repo(NO_CHECKS);
  let tddBlocks = 0;
  for (let i = 0; i < 4; i += 1) {
    write(root, 'src/a.js', String(i + 10));
    const d = stopDecision(qh(root, ['hook', 'stop'], CLAUDE));
    if (d?.decision === 'block' && /TDD/.test(d.reason)) tddBlocks += 1;
    write(root, 'docs/unrelated.md', `- ${i}\n`);
  }
  assert.strictEqual(tddBlocks, 2);
});

test('a new item still blocks after another item was given up', () => {
  const root = repo(NO_CHECKS);
  for (let i = 0; i < 3; i += 1) {
    write(root, 'src/a.js', String(i + 10));
    qh(root, ['hook', 'stop'], CLAUDE);
  }
  write(root, 'src/key.js', `export const k = "${'AKIA'}QHTESTFAKE000001";\n`);
  const d = stopDecision(qh(root, ['hook', 'stop'], CLAUDE));
  assert.strictEqual(d?.decision, 'block');
  assert.match(d.reason, /비밀값 의심/);
  assert.doesNotMatch(d.reason, /TDD/, 'the given-up item is not handed back');
});

test('a broken config makes stop exit 0 with one note naming the file for the agent, and status an environment error', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', '2');
  write(root, '.quality/config.json', '{ "baseRef": "main", "checks": {\n');
  const first = stopDecision(qh(root, ['hook', 'stop'], CLAUDE));
  assert.ok(first?.systemMessage, 'the person hears about it');
  assert.doesNotMatch(first.systemMessage, DEVELOPER_WORDS);
  assert.match(first.reason, /\.quality\/config\.json/);
  assert.strictEqual(stopDecision(qh(root, ['hook', 'stop'], CLAUDE)), null, 'told once');
  const s = qh(root, ['status']);
  assert.strictEqual(s.status, 3);
  assert.match(s.stdout, /환경 오류[\s\S]*\.quality\/config\.json/);
});

test('without stop_hook_active (Kiro) the block tells the agent to recheck itself and what to tell the person', () => {
  const root = repo(NO_CHECKS);
  write(root, 'src/a.js', '2');
  const d = stopDecision(qh(root, ['hook', 'stop'], kiro()));
  assert.strictEqual(d.decision, 'block');
  assert.match(d.reason, /qh status/);
  const tell = d.reason.split('What to tell the user')[1];
  assert.ok(tell, d.reason);
  assert.doesNotMatch(tell.split('\n').slice(1).join('\n'), DEVELOPER_WORDS, tell);
  const claude = repo(NO_CHECKS);
  write(claude, 'src/a.js', '2');
  assert.doesNotMatch(stopDecision(qh(claude, ['hook', 'stop'], CLAUDE)).reason, /What to tell the user/, 'Claude Code calls Stop again by itself');
});

test('what a Kiro turn left unresolved is told again at the next session start, once', () => {
  const root = repo(NO_CHECKS);
  write(root, 'src/a.js', '2');
  qh(root, ['hook', 'stop'], kiro());
  const first = qh(root, ['hook', 'session-start']).stdout;
  assert.match(first, /지난 세션이 끝날 때 남은 품질 문제/);
  assert.match(first, /테스트/);
  assert.doesNotMatch(qh(root, ['hook', 'session-start']).stdout, /지난 세션이 끝날 때/);
});

test('each session gets the fix list once, even when another session in the folder already got it', () => {
  const root = repo(NO_CHECKS);
  write(root, 'src/a.js', '2');
  assert.strictEqual(stopDecision(qh(root, ['hook', 'stop'], kiro('worker'))).decision, 'block');
  assert.strictEqual(stopDecision(qh(root, ['hook', 'stop'], kiro('coordinator'))).decision, 'block');
  assert.notStrictEqual(stopDecision(qh(root, ['hook', 'stop'], kiro('worker')))?.decision, 'block', 'same session, nothing changed');
});

test('a repository with no commit yet tells the person the first save starts the checks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-empty-'));
  sh(root, 'git', ['init', '-q', '-b', 'main']);
  write(root, '.quality/config.json', JSON.stringify(BASIC));
  write(root, 'src/a.js', '1');
  const d = stopDecision(qh(root, ['hook', 'stop'], CLAUDE));
  assert.match(d.reason, /커밋이 없/);
  const user = d.reason.match(/Tell the user: (.+)/)[1];
  assert.match(user, /첫 저장/);
  assert.doesNotMatch(user, /내려받을지/);
});

const failingCheck = (out) => ({ baseRef: 'main', checks: { db: { cmd: `node -e "console.error('${out}'); process.exit(1)"` } }, common: ['db'] });

test('a command check that fails because a database or docker is unreachable is an environment error', () => {
  for (const out of ['connect ECONNREFUSED 127.0.0.1:5432', 'Error: spawn docker ENOENT', 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock']) {
    const root = repo(failingCheck(out));
    write(root, 'src/a.js', '2');
    write(root, '.quality/tasks/work.md', DECLARED);
    assert.strictEqual(qh(root, ['check', 'db']).status, 3, out);
    const c = statusJson(root).checks.find((x) => x.name === 'db');
    assert.strictEqual(c.state, '환경 오류', out);
  }
});

test('a failing assertion stays a code failure even when the log mentions a refused connection', () => {
  const root = repo(failingCheck('AssertionError: expected retry after connect ECONNREFUSED'));
  write(root, 'src/a.js', '2');
  assert.strictEqual(qh(root, ['check', 'db']).status, 1);
  assert.strictEqual(statusJson(root).checks.find((x) => x.name === 'db').state, '실패');
});

test('the PR status blocks on a secret added and removed again in this branch, without printing it', () => {
  const root = repo(NO_CHECKS);
  const key = `${'AKIA'}QHTESTFAKE000002`;
  write(root, 'src/keys.js', `export const k = "${key}";\n`);
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'add key']);
  write(root, 'src/keys.js', 'export const k = process.env.K;\n');
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'env']);
  const pr = qh(root, ['status', '--pr']).stdout;
  assert.match(pr, /비밀값 기록: src\/keys\.js/);
  assert.doesNotMatch(pr, new RegExp(key));
  assert.doesNotMatch(qh(root, ['status']).stdout, /비밀값 기록/, 'Stop stays cheap: history is read at PR only');
});

test('the PR status blocks on an .env with a token committed and then taken out of git in this branch', () => {
  const root = repo(NO_CHECKS);
  write(root, '.env', 'API_TOKEN=abc123\n');
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'add env']);
  sh(root, 'git', ['rm', '-q', '--cached', '.env']);
  write(root, '.gitignore', '.env\n');
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'ignore env']);
  const pr = qh(root, ['status', '--pr']).stdout;
  assert.match(pr, /비밀값 기록: \.env/);
  assert.doesNotMatch(pr, /abc123/);
});

test('without Express, a login answer only warns about the access check; with Express it still fails', () => {
  const answers = { login: { choice: 'A' }, reviewer: { choice: 'C', reason: '혼자 실험 중' } };
  const plain = repo({ ...BASIC, answers });
  const out = qh(plain, ['doctor']).stdout;
  assert.match(out, /\[경고\] 답 "로그인 기능 있음" → 권한 검사\(route-access\)가 없다/);
  assert.match(out, /\[경고\] 답 "로그인 기능 있음" → 권한 표/);
  assert.match(out, /\[실패\] 답 "로그인 기능 있음" → 위험 영역 auth가 없다/, 'other answers still require their part');
  const app = repo({ ...BASIC, answers }, { 'package.json': JSON.stringify({ dependencies: { express: '^5.0.0' } }) });
  assert.match(qh(app, ['doctor']).stdout, /\[실패\] 답 "로그인 기능 있음" → 권한 검사\(route-access\)가 없다/);
});

test('status points out a decision written without a checkbox, and leaves "없음" alone', () => {
  const root = repo(NO_CHECKS);
  write(root, '.quality/tasks/work.md', '## 판단 필요\n- 재시도 간격 1초·3초\n- 없음\n\n## 미확인\n- 모름\n');
  const out = qh(root, ['status']).stdout;
  assert.match(out, /작업 카드: .*`- \[ \] 항목`.*재시도 간격 1초·3초/);
  assert.doesNotMatch(out, /작업 카드: .*없음/);
  assert.doesNotMatch(out, /모름/);
});

test('an unfilled probe is a question for the person, not an environment to switch on', () => {
  const root = repo({ baseRef: 'main', checks: { routes: { builtin: 'route-access', requests: false } }, common: ['routes'] });
  // The probe is reached only once the project's express resolves: lend it this repository's.
  fs.symlinkSync(path.join(__dirname, '..', 'node_modules'), path.join(root, 'node_modules'));
  fs.appendFileSync(path.join(root, '.git', 'info', 'exclude'), 'node_modules\n');
  write(root, '.quality/probe.mjs', "const todo = (what) => Object.assign(new Error(`.quality/probe.mjs의 ${what}을 채워야 한다`), { qhEnv: true })\nexport async function app() {\n  throw todo('app()')\n}\n");
  write(root, 'src/a.js', '2');
  write(root, '.quality/tasks/work.md', DECLARED);
  qh(root, ['check', 'routes']);
  assert.strictEqual(statusJson(root).checks[0].envKind, 'probe-todo');
  const d = stopDecision(qh(root, ['hook', 'stop'], CLAUDE));
  assert.match(d.reason, /Ask the user[\s\S]*probe\.mjs[\s\S]*채워도 될까요/);
  assert.doesNotMatch(d.reason, /환경을 켜면/);
});

test('an allowed-failure line needs a real reason: a placeholder or a too-short one allows nothing', () => {
  for (const [line, isAllowed] of [['기존 실패 허용: db · <왜 막지 않는지, 5자 이상> · 고쳐지면', false], ['기존 실패 허용: db · 짧음 · 고쳐지면', false], ['기존 실패 허용: db · main에서도 실패하고 따로 고친다 · 고쳐지면', true]]) {
    const root = repo(failingCheck('plain failure'));
    write(root, 'src/a.js', '2');
    write(root, '.quality/tasks/work.md', DECLARED);
    write(root, 'docs/decisions.md', `- 2026-11-18 · ${line}\n`);
    assert.strictEqual(qh(root, ['check', 'db']).status, isAllowed ? 0 : 1, line);
  }
});

test('doctor warns when no check runs the tests', () => {
  assert.match(qh(repo(BASIC), ['doctor']).stdout, /\[경고\] 테스트를 돌리는 검사가 없다/);
  const tested = repo({ ...BASIC, checks: { test: { cmd: 'npm test' } }, common: ['test'] });
  assert.doesNotMatch(qh(tested, ['doctor']).stdout, /테스트를 돌리는 검사가 없다/);
});

test('doctor warns about a limits value it will ignore, and the Stop time limit follows limits.stopSeconds', () => {
  const bad = qh(repo({ ...BASIC, limits: { reasonChars: 'five', stopSecond: 20 } }), ['doctor']).stdout;
  assert.match(bad, /\[경고\] limits\.reasonChars/);
  assert.match(bad, /\[경고\] limits\.stopSecond/);
  assert.doesNotMatch(qh(repo({ ...BASIC, limits: { reasonChars: 12 } }), ['doctor']).stdout, /limits\./);
  const slow = repo({ ...BASIC, checks: { test: { cmd: 'npm test' } }, common: ['test'] });
  write(slow, '.quality/evidence/test.json', JSON.stringify({ startedAt: '2026-11-17T00:00:00Z', finishedAt: '2026-11-17T00:00:15Z' }));
  assert.match(qh(slow, ['doctor']).stdout, /마지막 실행이 15초/);
  const relaxed = repo({ ...BASIC, checks: { test: { cmd: 'npm test' } }, common: ['test'], limits: { stopSeconds: 30 } });
  write(relaxed, '.quality/evidence/test.json', JSON.stringify({ startedAt: '2026-11-17T00:00:00Z', finishedAt: '2026-11-17T00:00:15Z' }));
  assert.doesNotMatch(qh(relaxed, ['doctor']).stdout, /마지막 실행이 15초/);
});
