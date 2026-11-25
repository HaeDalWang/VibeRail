'use strict';

// What the Stop hook remembers between calls, per agent session: several agents may
// share one folder (a coordinator and the Kiro worker it started), and each must be
// handed its fix list once. `pending` is folder-wide: what a one-shot host (Kiro) left
// unresolved, told again at the next session start. `askedRoutes` is folder-wide too.

const fs = require('node:fs');
const path = require('node:path');

const STOP_STATE = '.quality/evidence/stop-state.json';
// ponytail: the 20 most recent sessions are kept, a file per session if more agents share a folder.
const MAX_SESSIONS = 20;

function readAll(root) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root, STOP_STATE), 'utf8'));
    // An older single-state file is dropped: at worst the next Stop blocks once more.
    return data && typeof data.sessions === 'object' ? data : { sessions: {} };
  } catch {
    return { sessions: {} };
  }
}

function writeAll(root, data) {
  fs.mkdirSync(path.dirname(path.join(root, STOP_STATE)), { recursive: true });
  fs.writeFileSync(path.join(root, STOP_STATE), JSON.stringify(data));
}

const readSession = (root, id) => readAll(root).sessions[id] || {};

function writeSession(root, id, state, pending) {
  const data = readAll(root);
  const sessions = Object.entries({ ...data.sessions, [id]: { ...state, at: Date.now() } })
    .sort((x, y) => y[1].at - x[1].at)
    .slice(0, MAX_SESSIONS);
  const next = { ...data, sessions: Object.fromEntries(sessions) };
  if (pending !== undefined) next.pending = pending || undefined;
  writeAll(root, next);
}

// Read once: the next session start tells it, then it is gone.
function takePending(root) {
  const data = readAll(root);
  if (!data.pending) return null;
  writeAll(root, { ...data, pending: undefined });
  return data.pending;
}

// Routes the person was asked about (folder-wide): a table line for one of them is their answer.
// ponytail: kept until the folder's evidence is cleared, a per-branch list if old answers leak across branches.
function markAsked(root, routes) {
  const data = readAll(root);
  writeAll(root, { ...data, askedRoutes: [...new Set([...(data.askedRoutes || []), ...routes])] });
}
const askedRoutes = (root) => new Set(readAll(root).askedRoutes || []);

// The HEAD commit at the last time nothing was left to block or ask (folder-wide). On the base
// branch itself (merge-base == HEAD) the work is whatever came after it.
function markPassed(root, commit) {
  writeAll(root, { ...readAll(root), passedCommit: commit });
}
const lastPassed = (root) => readAll(root).passedCommit || null;

// Distinct unexpected messages block once, even if normal stops happen between errors.
function unexpectedError(root, host, message) {
  const systemMessage = '품질 검사 중 예상하지 못한 오류가 나서 판정하지 못했습니다. 검사 결과가 확인되지 않은 상태입니다.';
  const last = readSession(root, host.session);
  const errors = last.unexpectedErrors || [];
  if (errors.includes(message)) return { systemMessage };
  writeSession(root, host.session, { ...last, unexpectedErrors: [...errors, message] }, host.isOneShot ? `- ${systemMessage}` : undefined);
  return { reason: `qh: could not judge because of an unexpected error. Report it to the user before ending.\n${message}\nTell the user: ${systemMessage}`, systemMessage };
}

module.exports = { unexpectedError, readSession, writeSession, takePending, markAsked, askedRoutes, markPassed, lastPassed };
