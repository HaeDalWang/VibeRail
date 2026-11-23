'use strict';

// How many times in a row the Stop hook turns the agent back for the same kind of item is a limits key.

const test = require('node:test');
const assert = require('node:assert');
const { repo, write, qh, stopDecision, BASIC } = require('./helpers');

const CLAUDE = '{"stop_hook_active":true,"session_id":"s1"}';

function secondStopAfterAnotherChange(limits) {
  const root = repo({ ...BASIC, ...(limits ? { limits } : {}) });
  write(root, 'src/a.js', '2');
  assert.strictEqual(stopDecision(qh(root, ['hook', 'stop'], CLAUDE)).decision, 'block');
  write(root, 'src/a.js', '3');
  return stopDecision(qh(root, ['hook', 'stop'], CLAUDE));
}

test('by default the same kind of item turns the agent back twice, even when the tree changed in between', () => {
  assert.strictEqual(secondStopAfterAnotherChange(null)?.decision, 'block');
});

test('limits.sameBlocks lowers the number of repeated blocks', () => {
  assert.notStrictEqual(secondStopAfterAnotherChange({ sameBlocks: 1 })?.decision, 'block');
});
