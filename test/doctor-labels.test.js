'use strict';

// Doctor quotes the answer labels the person saw on the question screen, and the team CI check looks for a real run step.

const test = require('node:test');
const assert = require('node:assert');
const { repo, write } = require('./helpers');
const { doctor } = require('../lib/doctor');
const { QUESTIONS } = require('../lib/questions');

const ALL_A = { login: 'A', personal: 'A', db: 'A', external: 'A', team: 'A', deploy: 'A', reviewer: 'B', level: 'A' };
const withAnswers = (answers) => ({ baseRef: 'main', checks: {}, common: [], answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, { choice: v, date: '2026-11-19' }])) });
const quoted = (problems) => problems.map((p) => p.msg).filter((m) => m.startsWith('답 ')).map((m) => m.match(/^답 "([^"]+)"/)?.[1]);

test('every answer label doctor quotes is a label on the question screen', () => {
  const root = repo(withAnswers(ALL_A), { 'package.json': JSON.stringify({ dependencies: { express: '^5' } }) });
  const labels = new Set(QUESTIONS.flatMap((q) => q.options.map((o) => o.label)));
  const said = quoted(doctor(root));
  assert.ok(said.length >= 6, said.join(' | '));
  for (const label of said) assert.ok(labels.has(label), `"${label}" is not on the screen`);
  assert.ok(said.includes('외부 서비스 연동 있음') && said.includes('다른 AI 검토 적용'));
});

test('the team CI check needs a run step that calls qh.js; a comment that mentions it does not count', () => {
  const root = repo(withAnswers({ team: 'A' }));
  const teamMsg = () => doctor(root).some((p) => /"팀 협업 개발" → CI에서 qh를 돌리지 않는다/.test(p.msg));
  write(root, '.github/workflows/ci.yml', 'name: ci\non: pull_request\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      # TODO: run .quality/qh/bin/qh.js here\n      - run: npm test\n');
  assert.strictEqual(teamMsg(), true);
  write(root, '.github/workflows/ci.yml', 'name: ci\non: pull_request\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node .quality/qh/bin/qh.js check --pr\n');
  assert.strictEqual(teamMsg(), false);
  write(root, '.github/workflows/ci.yml', 'name: ci\njobs:\n  t:\n    steps:\n      - name: gate\n        run: |\n          node .quality/qh/bin/qh.js check --pr\n          node .quality/qh/bin/qh.js status --pr\n');
  assert.strictEqual(teamMsg(), false);
});
