'use strict';

// "AI를 돌려보낸 횟수" counts Stops that sent the agent back to fix something, one count per distinct kind.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { repo, write, qh, DECLARED, BASIC } = require('./helpers');
const { logStop } = require('../lib/measure');

const logLines = (root) => {
  const file = path.join(root, '.quality/evidence/stop-log.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

test('a Stop that only asks the person something is not counted as sending the agent back', () => {
  const root = repo(BASIC);
  write(root, 'src/a.js', '2');
  write(root, '.quality/tasks/work.md', `${DECLARED}## 판단 필요\n- [ ] 이 범위로 만들까요?\n`);
  assert.strictEqual(qh(root, ['check']).status, 0);
  const r = qh(root, ['hook', 'stop'], '{}');
  assert.match(r.stdout, /Ask the user/);
  assert.deepStrictEqual(logLines(root), []);
});

test('one block counts each kind once, and files growth/rule items under their own kinds', () => {
  const root = repo(BASIC);
  logStop(root, { aiFix: ['TDD: a', 'TDD: b', '문서 영향: x', '문서 증가: y', '문서 규칙: z', '의도: i', 'interface 결정: j'], human: [{}, {}, {}] });
  const [entry] = logLines(root);
  assert.deepStrictEqual(entry.kinds, { tdd: 1, docs: 1, other: 1, adr: 1, human: 1 });
});
