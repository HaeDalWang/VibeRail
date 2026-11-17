'use strict';

// `qh pr` and the PR status: blocked only by what this work or its person can settle.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { repo, write, sh, qh, DECLARED, BASIC } = require('./helpers');

const REVIEW_OK = { cmd: "node -e \"require('fs').writeFileSync('{out}/result.json','[]')\"" };

function installed(config = { ...BASIC, review: REVIEW_OK }) {
  const root = repo(config);
  assert.strictEqual(qh(root, ['init', root]).status, 0);
  write(root, 'src/a.js', '2');
  write(root, '.quality/tasks/work.md', DECLARED);
  return root;
}

test('status --base with a ref other than config.baseRef is not a criteria change', () => {
  const root = repo(BASIC);
  sh(root, 'git', ['branch', 'other', 'main']);
  write(root, 'src/a.js', '2');
  const s = JSON.parse(qh(root, ['status', '--json', '--base', 'other']).stdout);
  assert.deepStrictEqual(s.configChanges, []);
  assert.doesNotMatch(s.policy.join('\n'), /결정 로그/);
});

test('pr does not block on a missing code map, it only warns', () => {
  const root = installed();
  fs.rmSync(path.join(root, '.code-review-graph'), { recursive: true, force: true });
  fs.rmSync(path.join(root, '.mcp.json'), { force: true });
  const r = qh(root, ['pr']);
  assert.match(r.stdout, /\[경고\] 코드 지도 색인/);
  assert.strictEqual(r.status, 0, r.stdout);
});

test('pr lists setup problems only a person can settle under a report-to-user heading', () => {
  const root = installed();
  write(root, 'CLAUDE.md', '# rules\n');
  const r = qh(root, ['pr']);
  assert.strictEqual(r.status, 1);
  const at = r.stdout.indexOf('사용자에게 보고');
  assert.ok(at >= 0, r.stdout);
  assert.ok(r.stdout.indexOf('CLAUDE.md가 @AGENTS.md를') > at, r.stdout);
});

test('a review that cannot run is listed with the environment errors', () => {
  const root = installed({ ...BASIC, review: { cmd: 'true' } });
  const r = qh(root, ['pr']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /환경 오류 \(코드를 고치지 말고[^\n]*\n(?: {2}- .*\n)* {2}- AI 리뷰/);
});

test('pr passes with a check failure the decision log allows as already failing', () => {
  const root = installed({ ...BASIC, checks: { unit: { cmd: 'node -e "process.exit(1)"' } }, review: REVIEW_OK });
  write(root, 'docs/decisions.md', `${fs.readFileSync(path.join(root, 'docs/decisions.md'), 'utf8')}- 2026-11-18 · 기존 실패 허용: unit · main에서도 실패하고 따로 고친다 · 고쳐지면\n`);
  const r = qh(root, ['pr']);
  assert.match(r.stdout, /경고 \(막지 않음\)[\s\S]*unit/);
  assert.strictEqual(r.status, 0, r.stdout);
});
