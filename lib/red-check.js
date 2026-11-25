'use strict';

// Re-run tests against base code in a disposable clone; never restore the person's files in place.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isOwnCode, TEST_FILE, declared, splitRustTests } = require('./policy');
const { seamPaths } = require('./card');
const { checkLabel } = require('./triage');
const { shellQuote } = require('./shell-words');

const BLOCK = '코드 변경을 되돌려도 테스트가 통과한다 → 테스트가 이번 변경을 시험하지 않는다';
const WEAK = '약한 증거(새 파일이라 파일 없음으로만 확인)';
const FILE = '.quality/evidence/red-check.json';
const LOG = '.quality/evidence/red-check.log';
const DEFAULT_TIMEOUT_SEC = 300;
const under = (file, seam) => file === seam || file.startsWith(`${seam}/`);

function readRedCheck(root, treeHash) {
  const file = path.join(root, FILE);
  if (!fs.existsSync(file)) return { state: '확인 못 함', detail: '최종 검사를 아직 실행하지 않았다' };
  try {
    const ev = JSON.parse(fs.readFileSync(file, 'utf8'));
    return ev.treeHash === treeHash ? ev : { state: '확인 못 함', detail: '지금 코드보다 오래된 기록이다' };
  } catch {
    return { state: '확인 못 함', detail: '검사 기록을 읽지 못했다' };
  }
}

function groupsOf(code, card) {
  const seams = seamPaths(card);
  if (!seams.length) return [{ seam: '전체', files: code }];
  const groups = seams.map((seam) => ({ seam, files: code.filter((f) => under(f, seam)) }));
  const outside = code.filter((f) => !seams.some((s) => under(f, s)));
  return [...groups, ...(outside.length ? [{ seam: '그 밖의 코드', files: outside }] : [])].filter((g) => g.files.length);
}

function linkDependencies(root, dir, git) {
  // Only dependency folders are shared: generated test output stays in the disposable clone.
  const ignored = git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z']).split('\0').filter(Boolean);
  for (const rel of ignored.filter((f) => /(^|\/)node_modules\/$/.test(f))) {
    const dest = path.join(dir, rel.replace(/\/$/, ''));
    if (fs.existsSync(dest)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.symlinkSync(path.join(root, rel), dest, 'dir');
  }
}

function reversedRun(root, group, context, api) {
  const { base, treeHash, check } = context;
  const { git, hashTree, spawnCheck, runEnvError } = api;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-red-'));
  try {
    // A shared clone can read the snapshot's objects without writing the source repository's .git.
    const clone = spawnSync('git', ['clone', '--quiet', '--shared', '--no-checkout', '--', root, dir], { encoding: 'utf8' });
    if (clone.status !== 0) throw new Error(`임시 검사 공간을 만들지 못했다: ${clone.stderr || clone.error?.message}`);
    git(dir, ['read-tree', treeHash]);
    git(dir, ['checkout-index', '--all', '--force']);
    const existing = group.files.filter((f) => spawnSync('git', ['cat-file', '-e', `${base}:${f}`], { cwd: dir }).status === 0);
    for (const file of group.files.filter((f) => !existing.includes(f))) fs.rmSync(path.join(dir, file), { force: true });
    // A Rust file holds its own tests: keep this work's test part on the base code part.
    const rustTests = existing.filter((f) => f.endsWith('.rs')).map((f) => [f, splitRustTests(fs.readFileSync(path.join(dir, f), 'utf8')).tests]).filter(([, tests]) => tests);
    if (existing.length) git(dir, ['restore', '--source', base, '--staged', '--worktree', '--', ...existing]);
    for (const [f, tests] of rustTests) fs.writeFileSync(path.join(dir, f), splitRustTests(fs.readFileSync(path.join(dir, f), 'utf8')).code + tests);
    linkDependencies(root, dir, git);
    const before = hashTree(dir);
    const r = spawnCheck(dir, check, check.timeoutSec || DEFAULT_TIMEOUT_SEC);
    const log = `${r.stdout || ''}${r.stderr || ''}`;
    const timedOut = r.error?.code === 'ETIMEDOUT';
    const ev = { treeHash: before, exit: timedOut ? 124 : (r.status ?? 1), timedOut, logPath: LOG };
    const env = runEnvError(dir, check, ev, log);
    if (r.error || timedOut || r.signal || env.envError) return { ...group, state: '확인 못 함', ...env, envError: env.envError || '테스트를 정해진 시간 안에 실행하지 못했다', log };
    const state = ev.exit === 0 ? '막음' : existing.length ? '통과' : '약한 증거';
    return { ...group, state, detail: state === '막음' ? BLOCK : state === '약한 증거' ? WEAK : '기준 코드에서 테스트가 실패했다', log };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A seam is tested when at least one configured test fails; unrelated test commands may still pass.
function summarizeGroup(group, runs) {
  const state = ['확인 못 함', '통과', '약한 증거', '막음'].find((s) => runs.some((r) => r.state === s));
  const envError = runs.filter((r) => r.envError).map((r) => r.envError).join('; ');
  return { ...group, state, ...(envError ? { envError } : {}), checks: runs.map(({ log, ...r }) => r),
    log: runs.map((r) => `${r.check}: ${r.state}\n${r.log || r.envError || ''}`).join('\n') };
}

function runRedCheck(root, context, api) {
  const { config, changed, card, tests } = context;
  const code = changed.filter((f) => isOwnCode(f) && !TEST_FILE.test(f));
  const checks = Object.entries(config.checks || {}).filter(([name, c]) => c.cmd && (/^test(?:$|[-_])/.test(name) || /테스트/.test(checkLabel(c))));
  let detail = declared(card, '테스트 불필요') ? '테스트 불필요: 작업 카드의 면제로 건너뜀'
    : !code.length ? '바뀐 코드가 없다' : !checks.length ? '테스트 검사가 없다' : '';
  const results = [];
  if (!detail) {
    for (const group of groupsOf(code, card)) {
      const runs = [];
      for (const [name, def] of checks) {
        if (def.cmd.includes('{tests}') && !tests.length) continue;
        const check = { ...def, cmd: def.cmd.replaceAll('{tests}', tests.map(shellQuote).join(' ')) };
        try {
          runs.push({ check: name, ...reversedRun(root, group, { ...context, check }, api) });
        } catch (err) {
          runs.push({ check: name, ...group, state: '확인 못 함', envError: err.message });
        }
      }
      if (runs.length) results.push(summarizeGroup(group, runs));
    }
    if (!results.length) detail = '이번 작업에 실행할 테스트가 없다';
  }
  const state = ['막음', '확인 못 함', '약한 증거', '통과'].find((s) => results.some((r) => r.state === s)) || '확인 못 함';
  const envError = results.filter((r) => r.envError).map((r) => r.envError).join('; ');
  const ev = { treeHash: context.treeHash, state, detail: detail || (state === '막음' ? BLOCK : state === '약한 증거' ? WEAK : envError || '기준 코드에서 테스트가 실패했다'),
    ...(envError ? { envError } : {}), results: results.map(({ log, ...r }) => r), logPath: LOG, finishedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(path.join(root, FILE)), { recursive: true });
  fs.writeFileSync(path.join(root, LOG), results.map((r) => `${r.seam}: ${r.state}\n${r.log || r.envError || ''}`).join('\n'));
  fs.writeFileSync(path.join(root, FILE), `${JSON.stringify(ev, null, 2)}\n`);
  return ev;
}

module.exports = { runRedCheck, readRedCheck, BLOCK };
