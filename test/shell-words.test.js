'use strict';

// review.cmd placeholders reach the command as the exact value, wherever the user put them:
// bare, inside double or single quotes with other text, or inside "$(...)".

const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const { fillReviewCmd } = require('../lib/shell-words');

const VALUE = "/tmp/a b/it's $HOME";
const args = (cmd) => spawnSync('sh', ['-c', fillReviewCmd(cmd, { workdir: VALUE, task: VALUE, out: VALUE })], { encoding: 'utf8' }).stdout.split('\n').slice(0, -1);

test('a placeholder inside quotes with other text keeps the value and the text', () => {
  assert.deepStrictEqual(args(`printf '%s\\n' "{workdir}/x" 'y{out}' {task} "{task}" '{out}'`),
    [`${VALUE}/x`, `y${VALUE}`, VALUE, VALUE, VALUE]);
});

test('a placeholder inside "$(...)" is quoted for the inner command', () => {
  assert.deepStrictEqual(args(`printf '%s\\n' "$(printf %s {task})" "a $(printf %s "{task}") b"`), [VALUE, `a ${VALUE} b`]);
});
