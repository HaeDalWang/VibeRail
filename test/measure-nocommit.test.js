'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sh, qh } = require('./helpers');

test('qh measure in a repository with no commit gives the same plain environment message as status', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-empty-'));
  sh(root, 'git', ['init', '-q', '-b', 'main']);
  const r = qh(root, ['measure']);
  assert.strictEqual(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /환경 오류[\s\S]*커밋 없음/);
  assert.doesNotMatch(r.stderr, /Cannot read properties/);
});
