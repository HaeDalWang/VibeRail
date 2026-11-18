'use strict';

// Where "this work" starts. Normally the merge-base with the base ref. When HEAD is the base
// itself (merge-base == HEAD, work committed on main) that is empty, so the work is whatever
// came after the last commit qh saw pass, else after the commit that added the qh config.

const stopState = require('./stop-state');

const CONFIG_FILE = '.quality/config.json';

// git: bin/qh.js's runner (throws on a non-zero exit). Only when the checked-out branch is the
// base ref's own branch ("main" for main or origin/main): a new branch with no commit yet, a
// detached CI checkout or `--base HEAD` keep the plain merge-base.
function workBase(root, git, ref, mergeBase) {
  const head = git(root, ['rev-parse', 'HEAD']);
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (mergeBase !== head || !(ref === branch || ref.endsWith(`/${branch}`))) return mergeBase;
  const passed = stopState.lastPassed(root);
  if (passed && isAncestor(root, git, passed, head)) return passed;
  // Newest add: a config removed and put back means the current install. Not in HEAD at all: nothing to anchor on.
  const added = git(root, ['log', '--diff-filter=A', '--format=%H', head, '--', CONFIG_FILE]).split('\n').filter(Boolean)[0];
  return added && isTracked(root, git, head) ? added : mergeBase;
}

function isTracked(root, git, head) {
  try {
    git(root, ['cat-file', '-e', `${head}:${CONFIG_FILE}`]);
    return true;
  } catch {
    return false;
  }
}

function isAncestor(root, git, commit, head) {
  try {
    git(root, ['merge-base', '--is-ancestor', commit, head]);
    return true;
  } catch {
    return false;
  }
}

module.exports = { workBase };
