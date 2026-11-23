'use strict';

// A criteria change that comes from `qh answer`: one item per answered question, said by what changed.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
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
