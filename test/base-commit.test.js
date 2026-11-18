'use strict';

// Work committed on the base branch itself (merge-base == HEAD) is still this work:
// it is compared against the last commit qh saw pass, else the commit that added the config.

const test = require('node:test');
const assert = require('node:assert');
const { repo, write, sh, qh, statusJson, DECLARED, BASIC } = require('./helpers');

function onMain() {
  const root = repo(BASIC);
  sh(root, 'git', ['checkout', '-q', 'main']);
  return root;
}

function commit(root, rel, body, msg) {
  write(root, rel, body);
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', msg]);
}

test('committed work on the base branch is seen against the commit that added the config', () => {
  const root = onMain();
  commit(root, 'src/b.js', '2', 'work');
  assert.deepStrictEqual(statusJson(root).changed, ['src/b.js']);
});

test('after qh saw everything pass, only later commits on the base branch count', () => {
  const root = onMain();
  commit(root, 'src/b.js', '2', 'work');
  commit(root, '.quality/tasks/main.md', DECLARED, 'card');
  assert.strictEqual(qh(root, ['check']).status, 0);
  assert.deepStrictEqual(statusJson(root).changed, [], 'what passed is not shown again');
  commit(root, 'src/c.js', '3', 'more work');
  assert.deepStrictEqual(statusJson(root).changed, ['src/c.js']);
});

test('a commit that failed the gate is not recorded as seen to pass', () => {
  const root = onMain();
  commit(root, 'src/b.js', '2', 'work without test or doc declaration');
  qh(root, ['check']);
  assert.ok(statusJson(root).changed.includes('src/b.js'));
});
