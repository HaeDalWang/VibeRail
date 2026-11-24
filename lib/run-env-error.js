'use strict';

const fs = require('node:fs');
const path = require('node:path');
const PROBE_FILE = '.quality/probe.mjs';
const SHELL_NO_TOOL = [126, 127];
const lines = (text) => text.split('\n').filter(Boolean);

// Why a finished run says nothing about the code, if it does not: { envError, envKind } or {}.
function runEnvError(root, def, ev, log, { git, treeHash }) {
  // Evidence binds the tree it ran on; a check that rewrites tracked files can never be current.
  const touched = lines(git(root, ['diff', '--name-only', ev.treeHash, treeHash(root)]));
  if (touched.length) return { envError: `검사가 파일을 바꿨다: ${touched.join(', ')} → .gitignore에 넣거나 출력 경로를 옮긴다`, envKind: 'changed' };
  if (ev.result?.envError) return { envError: ev.result.envError, envKind: isProbeTodo(root, ev.result.envError) ? 'probe-todo' : 'builtin' };
  if (def.builtin || ev.exit === 0) return {};
  if (SHELL_NO_TOOL.includes(ev.exit)) return { envError: `도구 없음 또는 실행 불가 (exit ${ev.exit}, 로그: ${ev.logPath})`, envKind: 'tool' };
  const down = require('./run-builtin').serviceDown(log);
  if (down) return { envError: `필요한 서비스(DB·docker 등)에 연결하지 못함: ${down} (로그: ${ev.logPath}) → 코드를 고치지 말고 사용자에게 보고`, envKind: 'service' };
  return {};
}

// The probe draft from qh init still throws todo(): a person decides who fills it in.
const isProbeTodo = (root, envError) => {
  const file = path.join(root, PROBE_FILE);
  return envError.includes(PROBE_FILE) && fs.existsSync(file) && /throw todo\(/.test(fs.readFileSync(file, 'utf8'));
};

module.exports = { runEnvError };
