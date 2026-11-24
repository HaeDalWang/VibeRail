'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { spawnSync } = require('node:child_process');
const { checkLabel } = require('./triage');
const { isOwnCode, TEST_FILE } = require('./policy');

const CACHE = '.quality/evidence/coverage.json';
const DEFAULT_TIMEOUT_SEC = 300;
const MAX_BUFFER = 64 * 1024 * 1024;

function treeHash(root, git) {
  const index = path.join(os.tmpdir(), `qh-index-${process.pid}-${Date.now()}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    if (git(root, ['add', '-A'], env) === null) throw new Error('커버리지 코드 상태를 읽을 수 없습니다: git add 실패');
    // Measurements are a record about the code, not part of it: writing one keeps evidence current.
    git(root, ['rm', '-r', '--cached', '-q', '--ignore-unmatch', '--', '.quality/evidence', '.quality/metrics.csv', '.quality/reports'], env);
    const hash = git(root, ['write-tree'], env);
    if (hash === null) throw new Error('커버리지 코드 상태를 읽을 수 없습니다: git write-tree 실패');
    return hash.trim();
  } finally {
    fs.rmSync(index, { force: true });
  }
}
// # ponytail: Node V8 only; add pytest coverage.py and go cover adapters for other runtimes.
const fullTest = (name, def) => !def.builtin && !def.cmd?.includes('{tests}') && (name === 'test' || checkLabel(def) === '전체 테스트');
const nodeCommand = (root, name, def) => {
  if (!fullTest(name, def) || !def.cmd) return false;
  if (/\b(pytest|go|bun|cargo)\b/.test(def.cmd)) return false;
  if (/\bnode\b/.test(def.cmd)) return true;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return Boolean(pkg && !/\b(pytest|go|bun|cargo)\b/.test(pkg.scripts?.test || ''));
  } catch { return false; }
};

function readExecution(root, dir) {
  const executed = new Set();
  let seen = false;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const report = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (!Array.isArray(report.result)) throw new Error('V8 실행 기록 형식이 다릅니다');
    for (const script of report.result) {
      if (!script.url?.startsWith('file:') || !Array.isArray(script.functions)) continue;
      const rel = path.relative(fs.realpathSync(root), fileURLToPath(script.url)).split(path.sep).join('/');
      if (rel.startsWith('../') || !isOwnCode(rel)) continue;
      seen = true;
      // V8's first entry is the script/module wrapper, not a function body.
      if (!TEST_FILE.test(rel) && script.functions.slice(1).some((fn) => fn.ranges?.[0]?.count > 0)) executed.add(rel);
    }
  }
  return seen ? [...executed] : null;
}

function run(root, def, hash, currentHash, spawn, name) {
  if (!nodeCommand(root, name, def)) return spawn(process.env);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-coverage-'));
  try {
    const result = spawn({ ...process.env, NODE_V8_COVERAGE: dir });
    let executed = null;
    try {
      if (result.status !== null && !result.error && currentHash() === hash) executed = readExecution(root, dir);
    } catch (err) {
      console.warn(`커버리지를 잴 수 없음: ${err.message}`);
    }
    fs.mkdirSync(path.dirname(path.join(root, CACHE)), { recursive: true });
    fs.writeFileSync(path.join(root, CACHE), JSON.stringify({ hash, cmd: def.cmd, exit: result.status, executed }));
    return result;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function execution(root, git) {
  let config;
  try { config = JSON.parse(fs.readFileSync(path.join(root, '.quality/config.json'), 'utf8')); } catch { return null; }
  const entry = Object.entries(config.checks || {}).find(([name, def]) => fullTest(name, def));
  if (!entry || !nodeCommand(root, entry[0], entry[1])) return null;
  const [name, def] = entry;
  const hash = treeHash(root, git);
  try {
    const cached = JSON.parse(fs.readFileSync(path.join(root, CACHE), 'utf8'));
    if (cached.hash === hash && cached.cmd === def.cmd && (cached.executed === null || Array.isArray(cached.executed))) {
      return cached.executed === null ? null : new Set(cached.executed);
    }
  } catch { /* Missing or interrupted cache: measure again. */ }
  const result = run(root, def, hash, () => treeHash(root, git), (env) => spawnSync('sh', ['-c', def.cmd], {
    cwd: root, env, encoding: 'utf8', timeout: (def.timeoutSec || DEFAULT_TIMEOUT_SEC) * 1000, maxBuffer: MAX_BUFFER,
  }), name);
  fs.writeFileSync(path.join(root, '.quality/evidence/coverage-test.log'), `${result.stdout || ''}${result.stderr || ''}`);
  const cached = JSON.parse(fs.readFileSync(path.join(root, CACHE), 'utf8'));
  return cached.executed === null ? null : new Set(cached.executed);
}

module.exports = { treeHash, run, execution };
