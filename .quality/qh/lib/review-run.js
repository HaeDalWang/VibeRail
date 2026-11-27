'use strict';

// Runs one AI review command and reads its result.json: { cmd, exit, elapsedSec, findings } on success,
// { cmd, why, ... } on any failure. Each run is appended to logPath (relative to root).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { toolExists } = require('./shell-words');

const MAX_BUFFER = 64 * 1024 * 1024;

function readFindings(file) {
  let data = null;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!Array.isArray(data)) return null;
  const isValid = (f) => f && typeof f.file === 'string' && Number.isInteger(f.line) && typeof f.reason === 'string';
  return data.every(isValid) ? data : null;
}

function runReviewCmd(root, cmd, { outDir, logPath, timeoutSec }) {
  const missing = toolExists(root, cmd);
  if (missing) {
    fs.appendFileSync(path.join(root, logPath), `$ ${cmd}\n도구 없음: ${missing}\n`);
    return { cmd, why: `도구 없음: ${missing}` };
  }
  // ponytail: a timed-out reviewer's children may outlive sh and write result.json late; per-attempt out dirs if that shows up.
  fs.rmSync(path.join(outDir, 'result.json'), { force: true });
  const started = Date.now();
  const r = spawnSync('sh', ['-c', cmd], { cwd: root, encoding: 'utf8', timeout: timeoutSec * 1000, maxBuffer: MAX_BUFFER });
  fs.appendFileSync(path.join(root, logPath), `$ ${cmd}\n${r.stdout || ''}${r.stderr || ''}`);
  const findings = readFindings(path.join(outDir, 'result.json'));
  const run = { cmd, exit: r.status ?? 124, elapsedSec: Math.round((Date.now() - started) / 1000) };
  if (findings && run.exit === 0) return { ...run, findings };
  const why = run.exit === 124 ? '리뷰가 시간 초과로 멈춤' : run.exit !== 0 ? '리뷰가 정상 종료하지 않음' : '리뷰 결과(result.json)가 없거나 형식이 틀림';
  return { ...run, why: `${why} (exit ${run.exit})` };
}

module.exports = { runReviewCmd, readFindings };
