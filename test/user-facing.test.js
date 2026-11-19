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
  assert.match(criteriaWords({ checks: {} }, 0), /^아직 켜 둔 자동 검사가 없음/, 'a bare "없음" after a label means nothing to a non-developer');
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

test('a route question says what the route does and names the levels in Korean, with no address or level id', () => {
  const access = { accessLevels: ['public', 'member', 'admin'], accessLabels: { public: '누구나', member: '회원', admin: '관리자' } };
  const t = triage({ ...base(), undeclared: ['GET /api/users/:id', 'DELETE /api/orders/:id'], ...access });
  const [info, del] = t.human.map((x) => x.user);
  assert.match(info, /사용자 정보 보기/);
  assert.match(del, /주문 지우기/);
  assert.match(info, /누구나, 회원, 관리자/);
  for (const s of [info, del]) assert.doesNotMatch(s, /\/|public|member|admin|api/, s);
});

test('a route whose purpose cannot be derived is named as a new feature with the address in parentheses', () => {
  const t = triage({ ...base(), undeclared: ['GET /zzqx'], accessLevels: ['public', 'admin'] });
  const [s] = t.human.map((x) => x.user);
  assert.match(s, /^새로 생긴 기능\(주소 "\/zzqx"\)/);
  assert.match(s, /public, admin/, 'without labels the level ids are shown, as before');
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
  assert.match(snippet, /`## 판단 필요`[^\n]*a question the user can read and answer as is/, 'the gate shows the item to the person as is');
  assert.match(snippet, /allow lines[^\n]*only after asking the user and getting an answer/);
  assert.match(snippet, /In what you say to the user[^\n]*file paths, commands/);
  const guide = fs.readFileSync(path.join(LIB, 'ask-guide.md'), 'utf8');
  assert.match(guide, /## Allow lines/);
  assert.match(guide, /큰 파일 허용[\s\S]*중복 허용[\s\S]*only after asking the user and getting an answer/);
});

test('the agent rules ask choices with the arrow-key picker in Claude Code and numbered text elsewhere', () => {
  const snippet = fs.readFileSync(path.join(LIB, 'agents-snippet.md'), 'utf8');
  assert.match(snippet, /choices[^\n]*AskUserQuestion[^\n]*number/);
});

test('the report page tells the person what to say to the agent, not a command', () => {
  const page = fs.readFileSync(path.join(LIB, 'measure-page.js'), 'utf8');
  assert.doesNotMatch(page, /qh measure --backfill/);
  assert.match(page, /AI에게/);
});

test('the agent rules show the declaration reason as a placeholder, not a pasteable word', () => {
  const snippet = fs.readFileSync(path.join(LIB, 'agents-snippet.md'), 'utf8');
  assert.doesNotMatch(snippet, /불필요: (reason|이유)`|영향 없음: (reason|이유)`/);
  assert.match(snippet, /`테스트 불필요: <why no test is needed, 5\+ chars>`/);
});

test('the qh-cycle skill never asks the person to type a slash command; the agent opens the installed skill file', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'qh-cycle', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(skill, /(^|[\s`(])\/(to-spec|to-tickets|retro|improve-codebase-architecture|grill-with-docs)\b|command to type/);
  for (const name of ['to-spec', 'to-tickets', 'retro', 'improve-codebase-architecture']) assert.match(skill, new RegExp(`\\.claude/skills/${name}/SKILL\\.md`), name);
});

test('the installed agent guide shows how to add a test check after the person says yes', () => {
  const guide = fs.readFileSync(path.join(LIB, 'ask-guide.md'), 'utf8');
  const section = guide.slice(guide.indexOf('## Adding a check'));
  for (const re of [/^## Adding a check \(검사 넣기\)/, /Ask the user/, /only after they say yes/i, /"cmd"/, /\{tests\}/, /"on": \["pr"\]/]) assert.match(section, re);
});
