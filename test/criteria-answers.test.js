'use strict';

// A criteria change that comes from `qh answer`: one item per answered question, said by what changed.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { repo, qh, write, statusJson } = require('./helpers');
const { triage } = require('../lib/triage');

const BASIC = { baseRef: 'main', checks: { unit: { cmd: 'true' } }, common: ['unit'] };

test('an answered question is one criteria item that says what the answer became', () => {
  const root = repo(BASIC);
  const r = qh(root, ['answer'], 'qh 답\nreviewer=C 사유: 혼자 쓰는 도구라 검토는 건너뛴다\nlevel=B 사유: 개발자라서\n');
  assert.strictEqual(r.status, 0, r.stderr);
  const s = statusJson(root);
  assert.strictEqual(s.configChanges.length, 2, 'two questions answered, not six keys');
  const users = triage(s).human.filter((h) => /기준 변경/.test(h.agent)).map((h) => h.user);
  assert.strictEqual(users.length, 2);
  assert.ok(users.some((u) => /AI 검토.*검토 생략.*바뀌었습니다/.test(u)), users.join('\n'));
  assert.ok(users.every((u) => !/켜진 검사/.test(u)), 'the delta, not the list of current checks');
});

test('each answered question is confirmed by its own card line plus qh confirm', () => {
  const root = repo(BASIC);
  qh(root, ['answer'], 'qh 답\nreviewer=C 사유: 혼자 쓰는 도구라 검토는 건너뛴다\n');
  const [h] = triage(statusJson(root)).human.filter((x) => /기준 변경/.test(x.agent));
  write(root, '.quality/tasks/work.md', `## 판단 필요\n- [x] ${h.user} · 그대로 쓰겠습니다\n`);
  assert.strictEqual(qh(root, ['confirm']).status, 0);
  assert.deepStrictEqual(statusJson(root).configChanges, []);
});

test('qh answer refuses a reason shorter than limits.reasonChars, like the interface screen does', () => {
  const root = repo({ ...BASIC, limits: { reasonChars: 8 } });
  const short = qh(root, ['answer'], 'qh 답\nreviewer=B 사유: 다른 눈\n');
  assert.match(short.stdout, /저장하지 않음[\s\S]*AI 검토[\s\S]*8자/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, '.quality/config.json'), 'utf8')).answers, undefined);
  assert.strictEqual(qh(root, ['answer'], 'qh 답\nreviewer=B 사유: 다른 눈으로 보려고\n').status, 0);
});

const ME = '.quality/me.md';
const readMe = (root) => fs.readFileSync(path.join(root, ME), 'utf8');

test('a block with only a background line saves it to the per-person file, not the criteria or the decision log', () => {
  const root = repo(BASIC);
  const r = qh(root, ['answer'], 'qh 답\n배경: 클라우드 운영 엔지니어, 고객사 AWS 계정 점검\n');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(readMe(root), /## 배경\n클라우드 운영 엔지니어, 고객사 AWS 계정 점검\n/);
  assert.match(readMe(root), /## 단어집\n\| 개발 말 \| 내 말 \|/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, '.quality/config.json'), 'utf8')).answers, undefined);
  assert.deepStrictEqual(statusJson(root).configChanges, []);
  assert.ok(!fs.existsSync(path.join(root, 'docs/decisions.md')), 'background never goes to the decision log');
});

test('saving a new background keeps the word list and anything else the person wrote', () => {
  const root = repo(BASIC);
  write(root, ME, '# 나\n\n## 배경\n예전 배경\n\n## 단어집\n| 개발 말 | 내 말 |\n|---|---|\n| 커밋 | 작업 저장 지점 |\n\n## 메모\n손으로 쓴 줄\n');
  assert.strictEqual(qh(root, ['answer'], 'qh 답\n배경: 새 배경\n').status, 0);
  assert.strictEqual(readMe(root), '# 나\n\n## 배경\n새 배경\n\n## 단어집\n| 개발 말 | 내 말 |\n|---|---|\n| 커밋 | 작업 저장 지점 |\n\n## 메모\n손으로 쓴 줄\n');
});

test('a background over the length cap is refused with the limit named, and nothing is written', () => {
  const root = repo(BASIC);
  const r = qh(root, ['answer'], `qh 답\n배경: ${'가'.repeat(501)}\n`);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /저장하지 않음[\s\S]*배경[\s\S]*500자/);
  assert.ok(!fs.existsSync(path.join(root, ME)));
  assert.strictEqual(qh(root, ['answer'], `qh 답\n배경: ${'가'.repeat(500)}\n`).status, 0);
});

test('an unchanged background copied back from the page is left alone, even when a hand edit made it longer than the cap', () => {
  const root = repo(BASIC);
  const file = `# 나\n\n## 배경\n${'가'.repeat(300)}\n${'나'.repeat(300)}\n\n## 단어집\n| 개발 말 | 내 말 |\n|---|---|\n`;
  write(root, ME, file);
  assert.strictEqual(qh(root, ['answer'], `qh 답\n배경: ${'가'.repeat(300)} ${'나'.repeat(300)}\n`).status, 0);
  assert.strictEqual(readMe(root), file);
});

test('an old install whose .gitignore lacks the per-person file gets the ignore line, so git never sees the file', () => {
  const root = repo(BASIC, { '.gitignore': 'node_modules/\n' });
  assert.strictEqual(qh(root, ['answer'], 'qh 답\n배경: 데이터 분석가\n').status, 0);
  assert.strictEqual(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), `node_modules/\n${ME}\n`);
  assert.strictEqual(spawnSync('git', ['status', '--porcelain', '--', ME], { cwd: root, encoding: 'utf8' }).stdout, '');
  qh(root, ['answer'], 'qh 답\n배경: 데이터 분석가 2\n');
  assert.strictEqual(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), `node_modules/\n${ME}\n`, 'once');
});

test('the question page has a background box under the level question, prefilled, and copies it only when filled', async () => {
  const { load } = require('./mini-dom');
  const { ask } = require('../lib/ask');
  const root = repo(BASIC);
  write(root, ME, '# 나\n\n## 배경\n네트워크 <운영> 엔지니어\n\n## 단어집\n| 개발 말 | 내 말 |\n|---|---|\n');
  const html = fs.readFileSync(ask(root, { answers: {} }), 'utf8');
  assert.match(html, /<textarea class="bg" maxlength="500">/, 'the box stops typing at the limit qh answer enforces');
  const { document, copied } = load(html);
  const box = document.querySelector('[data-id=level]').querySelector('textarea.bg');
  assert.ok(box, 'the box sits in the level card');
  assert.strictEqual(box.textContent, '네트워크 <운영> 엔지니어');
  await document.getElementById('copy').onclick();
  assert.match(copied.at(-1), /\n배경: 네트워크 <운영> 엔지니어$/, 'untouched prefilled box is copied too');
  box.value = '네트워크   운영\n엔지니어';
  await document.getElementById('copy').onclick();
  assert.match(copied.at(-1), /\n배경: 네트워크 운영 엔지니어$/);
  box.value = '  ';
  await document.getElementById('copy').onclick();
  assert.doesNotMatch(copied.at(-1), /배경:/);
});

test('a background that starts with # marks is saved as text, not as a new heading', () => {
  const root = repo(BASIC);
  assert.strictEqual(qh(root, ['answer'], 'qh 답\n배경: ## 단어집 운영 엔지니어\n').status, 0);
  assert.match(readMe(root), /## 배경\n단어집 운영 엔지니어\n/);
  assert.strictEqual(readMe(root).match(/^## 단어집/gm).length, 1);
});
