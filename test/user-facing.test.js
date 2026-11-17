'use strict';

// Sentences a non-developer reads: check and risk names in plain words, the address a
// route question is about, and the rules the agent gets for talking to the person.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { triage, aiFixUser, criteriaWords } = require('../lib/triage');
const { repo, write, statusJson, BASIC } = require('./helpers');

const DEVELOPER_WORDS = /\S\/|\/\S|\.json\b|\b[0-9a-f]{7,}\b|`|\bgit |qh|\bTDD\b|\bADR\b|\b(test|sql|routes|access|unit|lint|auth|db|external)\b|test-work/i;
const LIB = path.join(__dirname, '..', 'lib');

const INIT_CONFIG = {
  checks: {
    test: { cmd: 'npm test', on: ['pr'] },
    'test-work': { cmd: 'node --test {tests}' },
    sql: { builtin: 'sql-prepare' },
    routes: { builtin: 'route-access', requests: false },
    access: { builtin: 'route-access' },
    lint: { cmd: 'npx eslint .' },
  },
  risks: { auth: { paths: ['src/auth/**'] }, db: { paths: ['migrations/**'] }, external: { paths: ['src/api/**'] }, 결제: { paths: ['src/pay/**'] } },
};

test('the criteria summary names checks and risk areas in plain words', () => {
  const words = criteriaWords(INIT_CONFIG, 264);
  assert.doesNotMatch(words, DEVELOPER_WORDS, words);
  assert.match(words, /전체 테스트/);
  assert.match(words, /바뀐 코드의 테스트/);
  assert.match(words, /데이터베이스 쿼리/);
  assert.match(words, /접근 권한/);
  assert.match(words, /로그인·권한/);
  assert.match(words, /결제/);
  assert.match(words, /264/);
  assert.match(criteriaWords({ checks: {} }, 0), /켜진 검사: 없음/);
});

test('a first-install question to the person carries no check or risk names', () => {
  const t = triage({ ...base(), configChanges: ['qh 첫 설치'], criteria: { isFirstInstall: true, summary: criteriaWords(INIT_CONFIG, 3) } });
  assert.doesNotMatch(t.human[0].user, DEVELOPER_WORDS, t.human[0].user);
});

function base() {
  return { phase: 'stop', config: INIT_CONFIG, checks: [], docsMissing: [], policy: [], structure: [], undeclared: [], decisions: [], taskQuestions: [], configChanges: [], env: [] };
}

test('every kind of item the agent gives up on has a plain sentence for the person', () => {
  const items = [
    'TDD: 코드(src/a.js)가 바뀌었는데 테스트 변경이 없다 → … `테스트 불필요: 이유`',
    '문서 영향: 코드가 바뀌었는데 문서 변경이 없다 → .quality/tasks/work.md에 `문서 영향 없음: 이유`',
    'ADR: 위험 영역(auth)이 바뀌었다 → docs/adr/NNNN-제목.md',
    '결정 로그: 품질 기준(.quality/config.json·access.json)이 바뀌었다 → docs/decisions.md',
    '개인정보 로그: src/a.js:3 로그에 개인정보 이름',
    '연동 실패 테스트: 외부 연동 코드가 바뀌었는데 …',
    '비밀값 파일: .env가 git에 올라갈 상태다',
    '비밀값 의심: src/a.js:1 (AWS 액세스 키) → …',
    '비밀값 기록: src/a.js (커밋 abc1234, AWS 액세스 키) → …',
    '중복: src/a.js:1 ↔ src/b.js:1 → `중복 허용: src/a.js · 이유`',
    '큰 파일: src/server.mjs가 819줄(기준 816, 한도 800) → …',
    '루트 파일: 저장소 맨 위에 새 파일 x.js → …',
    '죽은 링크: README.md:3 → docs/x.md 가 없다',
    '검사 test-work: 실패(이전 상태) → 고친 뒤 `qh check test-work`\n    exit 1 (로그: .quality/evidence/test-work.log)',
    '검사 unit: 미실행 → `qh check unit` 실행',
    '문서 미갱신: docs/auth.md (위험 auth의 연동 문서) → 같은 작업에서 갱신',
    '작업 카드: .quality/tasks/work.md `## 판단 필요`의 목록에 체크박스가 없다',
    '아무도 모르는 새 항목: src/x.js → `qh 무언가`',
  ];
  const sentences = items.map((x) => aiFixUser(x, INIT_CONFIG));
  for (const [i, s] of sentences.entries()) {
    assert.ok(s, items[i]);
    assert.doesNotMatch(s, DEVELOPER_WORDS, `${items[i]} → ${s}`);
  }
  assert.match(sentences[13], /바뀐 코드의 테스트/, 'a failing check is named by what it does');
});

test('a route question names the address and the levels of this project, one sentence per route', () => {
  const t = triage({ ...base(), undeclared: ['GET /admin/users', 'GET /admin/stats'], accessLevels: ['public', 'admin'] });
  const [users, stats] = t.human.map((x) => x.user);
  assert.match(users, /\/admin\/users/);
  assert.match(stats, /\/admin\/stats/);
  assert.match(users, /public, admin/);
  assert.doesNotMatch(users, /로그인한 회원만/);
  assert.doesNotMatch(users.replace('/admin/users', ''), DEVELOPER_WORDS, users);
});

test('a route qh asked the person about and then placed in the existing access table is not asked about again', () => {
  const access = { levels: ['public', 'admin'], routes: { 'GET /health': 'public' } };
  const root = repo(BASIC, { '.quality/access.json': JSON.stringify(access) });
  write(root, 'docs/decisions.md', '- 2026-11-18 · 결정 · 이유 · 조건\n');
  write(root, '.quality/access.json', JSON.stringify({ ...access, routes: { ...access.routes, 'GET /admin/users': 'admin' } }));
  assert.match(statusJson(root).configChanges.join('\n'), /access\.routes\.GET \/admin\/users/, 'a route nobody asked the person about is still confirmed');
  require('../lib/stop-state').markAsked(root, ['GET /admin/users']);
  assert.deepStrictEqual(statusJson(root).configChanges, [], 'the route qh asked the person about is their answer');
  write(root, '.quality/access.json', JSON.stringify({ ...access, routes: { 'GET /health': 'admin' } }));
  assert.match(statusJson(root).configChanges.join('\n'), /access\.routes\.GET \/health/, 'changing a level a person set is still asked');
});

test('environment and allowed-failure sentences name the check by what it does', () => {
  const t = triage({
    ...base(),
    checks: [
      { name: 'test', state: '환경 오류', envKind: 'tool', detail: ['도구 없음: jest'] },
      { name: 'routes', state: '환경 오류', envKind: 'service', detail: ['connect ECONNREFUSED'] },
      { name: 'lint', state: '실패', isCurrent: true, detail: ['exit 1'] },
    ],
    allowedFailures: ['lint'],
  });
  for (const x of [...t.env, ...t.warnings]) assert.doesNotMatch(x.user, DEVELOPER_WORDS, x.user);
  assert.match(t.env[0].user, /전체 테스트/);
});

test('the agent rules say how to write decisions, when allow lines may be written, and how to talk to the person', () => {
  const snippet = fs.readFileSync(path.join(LIB, 'agents-snippet.md'), 'utf8');
  assert.match(snippet, /`## 판단 필요`[^\n]*`- \[ \] /);
  assert.match(snippet, /허용[^\n]*사용자에게 묻고[^\n]*답을 받은 뒤에만/);
  assert.match(snippet, /사용자에게 하는 말[^\n]*경로·명령/);
  const guide = fs.readFileSync(path.join(LIB, 'ask-guide.md'), 'utf8');
  assert.match(guide, /## 허용 줄/);
  assert.match(guide, /큰 파일 허용[\s\S]*중복 허용[\s\S]*답을 받은 뒤에만/);
});

test('the report page tells the person what to say to the agent, not a command', () => {
  const page = fs.readFileSync(path.join(LIB, 'measure-page.js'), 'utf8');
  assert.doesNotMatch(page, /qh measure --backfill/);
  assert.match(page, /에이전트에게/);
});

test('the agent rules show the declaration reason as a placeholder, not a pasteable word', () => {
  const snippet = fs.readFileSync(path.join(LIB, 'agents-snippet.md'), 'utf8');
  assert.doesNotMatch(snippet, /불필요: 이유`|영향 없음: 이유`/);
  assert.match(snippet, /`테스트 불필요: <왜 필요 없는지, 5자 이상>`/);
});

test('the qh-cycle skill never asks the person to type a slash command; the agent opens the installed skill file', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'qh-cycle', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(skill, /(^|[\s`(])\/(to-spec|to-tickets|retro|improve-codebase-architecture|grill-with-docs)\b|command to type/);
  for (const name of ['to-spec', 'to-tickets', 'retro', 'improve-codebase-architecture']) assert.match(skill, new RegExp(`\\.claude/skills/${name}/SKILL\\.md`), name);
});
