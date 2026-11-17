'use strict';

// Judgement rules found by the end-to-end runs: what counts as code to test, which files are
// tool files, what a declaration or an allow line must say, and what is a secret file.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { repo, write, sh, statusJson, BASIC } = require('./helpers');
const { relatedTests } = require('../lib/policy');

const policyOf = (root) => statusJson(root).policy.join('\n');
const structureOf = (root) => statusJson(root).structure.join('\n');
const DOCS_OK = '문서 영향 없음: 사용자에게 안 보임\n';
const TESTS_OK = '테스트 불필요: 설정 파일만 바꿈\n';
const copyBody = `export function normalizeUser(input) {
  const name = input.name.trim().toLowerCase();
  const tags = input.tags.filter((t) => t.length > 0).map((t) => t.trim());
  const score = tags.reduce((n, t) => n + t.length, 0) * input.weight;
  if (score > input.limit) throw new Error('too big');
  const result = { name, tags, score, createdAt: input.createdAt.toISOString() };
  return Object.freeze(result);
}
`;

// ---------- A03: declaration placeholders ----------

test('the first TDD hint shows a placeholder with the five-character rule', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', '2');
  write(root, '.quality/tasks/work.md', DOCS_OK);
  assert.match(policyOf(root), /TDD:.*`테스트 불필요: <[^>]+5자 이상>`/);
});

test('pasting the hint placeholder as it is does not count as a reason', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', '2');
  write(root, '.quality/tasks/work.md', `${DOCS_OK}- 테스트 불필요: <왜 필요 없는지, 5자 이상>\n`);
  assert.match(policyOf(root), /TDD:/);
});

// ---------- A08: tool files ----------

test('a new lock file or tool config at the top is not a root file and needs no test', () => {
  const root = repo(BASIC, { 'package.json': '{"name":"app"}\n' });
  write(root, 'package-lock.json', '{"lockfileVersion":3}\n');
  write(root, 'eslint.config.js', 'export default [];\n');
  write(root, 'tsconfig.json', '{}\n');
  write(root, '.quality/tasks/work.md', DOCS_OK);
  assert.doesNotMatch(structureOf(root), /루트 파일/);
  assert.doesNotMatch(policyOf(root), /TDD/);
});

test('a new plain code file at the top is still a root file', () => {
  const root = repo(BASIC);
  write(root, 'notes.js', '1\n');
  assert.match(structureOf(root), /루트 파일: .*notes\.js/);
});

// ---------- A09: deleted code ----------

test('deleting a code file asks for no test change', () => {
  const root = repo(BASIC, { 'src/old.js': 'export const old = 1;\n' });
  sh(root, 'git', ['rm', '-q', 'src/old.js']);
  write(root, '.quality/tasks/work.md', DOCS_OK);
  assert.doesNotMatch(policyOf(root), /TDD/);
});

// ---------- A12: TDD per package ----------

test('a test in another package does not cover a code change', () => {
  const root = repo(BASIC, { 'frontend/package.json': '{}\n', 'frontend/src/App.jsx': '1\n', 'backend/package.json': '{}\n', 'backend/test/users.test.js': '1\n' });
  write(root, 'frontend/src/App.jsx', '2\n');
  write(root, 'backend/test/users.test.js', '2\n');
  write(root, '.quality/tasks/work.md', DOCS_OK);
  assert.match(policyOf(root), /TDD: 코드\(frontend\/src\/App\.jsx\)/);
});

test('a test in the same package covers a code change', () => {
  const root = repo(BASIC, { 'frontend/package.json': '{}\n', 'frontend/src/App.jsx': '1\n', 'backend/package.json': '{}\n' });
  write(root, 'frontend/src/App.jsx', '2\n');
  write(root, 'frontend/test/App.test.jsx', '1\n');
  write(root, '.quality/tasks/work.md', DOCS_OK);
  assert.doesNotMatch(policyOf(root), /TDD/);
});

test('without package files any changed test covers the code change, as before', () => {
  const root = repo(BASIC, { 'lib/x.js': '1\n', 'test/y.test.js': '1\n' });
  write(root, 'lib/x.js', '2\n');
  write(root, 'test/y.test.js', '2\n');
  write(root, '.quality/tasks/work.md', DOCS_OK);
  assert.doesNotMatch(policyOf(root), /TDD/);
});

// ---------- A17 + B9: allow lines in the decision log ----------

test('a duplicate allow line with the placeholder reason does not allow the copy', () => {
  const root = repo(BASIC, { 'src/util.js': copyBody });
  write(root, 'src/admin.js', copyBody.replace('normalizeUser', 'normalizeAdmin'));
  write(root, 'docs/decisions.md', '- 2026-01-01 · 중복 허용: src/admin.js · 이유\n');
  assert.match(structureOf(root), /중복: src\/admin\.js/);
  write(root, 'docs/decisions.md', '- 2026-01-01 · 중복 허용: src/admin.js · 외부 계약이라 따로 둔다\n');
  assert.doesNotMatch(structureOf(root), /중복: src\/admin\.js/);
});

test('allow-line hints show a placeholder and say to ask the person first', () => {
  const root = repo(BASIC, { 'src/util.js': copyBody });
  write(root, 'src/admin.js', copyBody.replace('normalizeUser', 'normalizeAdmin'));
  write(root, 'src/table.js', `${Array.from({ length: 900 }, (_, i) => `const v${i} = ${i};`).join('\n')}\n`);
  const out = structureOf(root);
  assert.match(out, /중복:.*사용자에게 묻고.*`중복 허용: src\/admin\.js · <[^>]+5자 이상>`/);
  assert.match(out, /큰 파일:.*사용자에게 묻고.*`큰 파일 허용: src\/table\.js · <[^>]+5자 이상>`/);
});

test('a big-file allow line with a too-short reason does not allow it', () => {
  const root = repo(BASIC);
  write(root, 'src/table.js', `${Array.from({ length: 900 }, (_, i) => `const v${i} = ${i};`).join('\n')}\n`);
  write(root, 'docs/decisions.md', '- 큰 파일 허용: src/table.js · 이유\n');
  assert.match(structureOf(root), /큰 파일: src\/table\.js/);
});

// ---------- A18: merge conflict markers ----------

test('a changed file with merge conflict markers blocks', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', `${'<'.repeat(7)} HEAD\n2\n${'='.repeat(7)}\n3\n${'>'.repeat(7)} main\n`);
  write(root, '.quality/tasks/work.md', `${DOCS_OK}${TESTS_OK}`);
  assert.match(policyOf(root), /충돌 표시: src\/a\.js:1/);
});

// ---------- B4: {tests} keeps to the code's language ----------

test('tests picked for a changed .ts file are of the same language family', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-rel-'));
  for (const f of ['src/api.ts', 'tests/test_api.py', 'test/api.test.js', 'pkg/api_test.go', 'pkg/api.go', 'tests/api_test.py']) write(root, f, '1');
  const tracked = ['src/api.ts', 'tests/test_api.py', 'test/api.test.js', 'pkg/api_test.go', 'pkg/api.go', 'tests/api_test.py'];
  assert.deepStrictEqual(relatedTests(root, ['src/api.ts'], tracked), ['test/api.test.js']);
  assert.deepStrictEqual(relatedTests(root, ['pkg/api.go'], tracked), ['pkg/api_test.go']);
  write(root, 'app/api.py', '1');
  assert.deepStrictEqual(relatedTests(root, ['app/api.py'], [...tracked, 'app/api.py']), ['tests/api_test.py', 'tests/test_api.py']);
});

// ---------- B8: .env out of git ----------

test('a committed .env taken out of git and ignored is not a secret file', () => {
  const root = repo(BASIC, { '.env': 'SECRET=x\n' });
  sh(root, 'git', ['rm', '-q', '--cached', '.env']);
  write(root, '.gitignore', '.env\n');
  write(root, '.quality/tasks/work.md', `${DOCS_OK}${TESTS_OK}`);
  assert.doesNotMatch(policyOf(root), /비밀값 파일/);
});

test('a new .env that is not ignored is still a secret file', () => {
  const root = repo(BASIC);
  write(root, '.env', 'SECRET=x\n');
  assert.match(policyOf(root), /비밀값 파일: \.env/);
});
