'use strict';

// The metric and the gate count lines the same way: a file of exactly the limit is not "over" for either.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { repo, write, qh, sh, BASIC } = require('./helpers');

const lines = (n) => Array.from({ length: n }, (_, i) => `const v${i} = ${i};`).join('\n') + '\n';
const overCount = (root) => {
  assert.strictEqual(qh(root, ['measure']).status, 0);
  const [head, ...rows] = fs.readFileSync(path.join(root, '.quality/metrics.csv'), 'utf8').trim().split('\n');
  return Number(rows.at(-1).split(',')[head.split(',').indexOf('files_over_800')]);
};

test('a file of exactly 800 lines is not counted as over 800 by qh measure', () => {
  const root = repo(BASIC, { 'src/big.js': lines(800) });
  assert.strictEqual(overCount(root), 0);
  write(root, 'src/big.js', lines(801));
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-qm', 'grow']);
  assert.strictEqual(overCount(root), 1);
});
