'use strict';

// `qh pr` reads the branch history for secrets: a key added in one commit and removed in
// the next is no longer in the working tree, but a push publishes it.

const { spawnSync } = require('node:child_process');
const { secretKind } = require('./policy');

const MAX_BUFFER = 64 * 1024 * 1024;

function gitLog(root, args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, encoding: 'utf8', maxBuffer: MAX_BUFFER });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${(r.stderr || '').trim()}`);
  return r.stdout;
}

// Lines each commit of this branch added, per file: what a push publishes even when a later commit removed it.
function addedLines(root, base) {
  const out = new Map();
  let [commit, file, isHeader] = ['', null, false];
  for (const line of gitLog(root, ['log', '-p', '--no-color', '--no-ext-diff', '--format=commit %h', `${base}..HEAD`]).split('\n')) {
    if (line.startsWith('commit ')) [commit, file, isHeader] = [line.slice('commit '.length), null, false];
    else if (line.startsWith('diff --git ')) [file, isHeader] = [null, true];
    else if (isHeader && line.startsWith('+++ ')) file = line === '+++ /dev/null' ? null : line.slice('+++ b/'.length);
    else if (isHeader && line.startsWith('@@')) isHeader = false;
    else if (!isHeader && file && line.startsWith('+')) {
      const key = `${commit}\0${file}`;
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(line.slice(1));
    }
  }
  return out;
}

// Secrets in the branch history, found by the same patterns as the working tree (lib/policy.js).
// Only the file, commit and kind are told: never the value.
function historySecretProblems(root, base) {
  const seen = new Map();
  for (const [key, added] of addedLines(root, base)) {
    const [commit, file] = key.split('\0');
    if (file.startsWith('.quality/qh/')) continue;
    for (const kind of new Set(added.map((line) => secretKind(line, file)).filter(Boolean))) {
      if (!seen.has(`${file}\0${kind}`)) seen.set(`${file}\0${kind}`, `비밀값 기록: ${file} (커밋 ${commit}, ${kind}) → 이 브랜치 커밋 기록에 남아 push하면 공개된다. 사용자에게 알리고, 답을 받은 뒤 그 커밋을 고쳐 기록에서 지운다. 키는 교체해야 한다고 사용자에게 알린다`);
    }
  }
  return [...seen.values()];
}

module.exports = { historySecretProblems };
