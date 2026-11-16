'use strict';

// `qh measure`: one row of numbers per measurement in .quality/metrics.csv (rows are never
// removed), and a local results page that shows first → now and each item's history.
// `--backfill <weeks>` also measures one commit per past week in a throwaway clone, so the
// page has a "before qh" stretch to compare with.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CODE_EXT, TEST_FILE, OWN_FILES, MAX_SCAN_BYTES, DECISIONS_FILE, relatedTests } = require('./policy');
const { duplicateStats, deadLinkProblems, MAX_FILE_LINES } = require('./structure');

const METRICS_FILE = '.quality/metrics.csv';
const STOP_LOG = '.quality/evidence/stop-log.jsonl';
const DAY_SEC = 86400;
const FEAT_WINDOW_DAYS = 60;
const COMMIT_WINDOW_DAYS = 90;
const BLOCK_WINDOW_DAYS = 30;

// [key, label, note, direction]: 'lower' = fewer is better, 'ref' = for scale only.
const GROUPS = [
  ['코드 구조', [
    ['files_over_800', `${MAX_FILE_LINES}줄 넘는 코드 파일`, '고칠 때 영향 범위가 큰 파일', 'lower'],
    ['largest_file_lines', '가장 큰 코드 파일', '줄 수', 'lower'],
    ['duplicated_lines', '중복 코드', '다른 곳에 같은 덩어리가 있는 줄 수', 'lower'],
    ['root_files', '저장소 맨 위의 파일', '폴더 밖에 놓인 파일 수', 'lower'],
  ]],
  ['테스트', [
    ['untested_pct', '같은 이름 테스트가 없는 코드 파일', '비율(%)', 'lower'],
  ]],
  ['문서와 결정', [
    ['dead_doc_links', '문서가 가리키는 없는 파일', '문서↔코드 불일치', 'lower'],
    ['decision_lines', '결정 로그', '줄 수', 'ref'],
    ['adr_files', 'ADR', '개수', 'ref'],
  ]],
  ['개발 흐름', [
    ['feat_median_files_60d', '기능 1건당 수정 파일 수', `최근 ${FEAT_WINDOW_DAYS}일 중앙값`, 'lower'],
  ]],
  [`qh 작동 (최근 ${BLOCK_WINDOW_DAYS}일)`, [
    ['stop_blocks_30d', '에이전트를 돌려보낸 횟수', 'Stop 차단', 'ref'],
    ['block_tdd', '└ 테스트 없이 코드 변경', '', 'ref'],
    ['block_docs', '└ 문서 미갱신', '', 'ref'],
    ['block_adr', '└ ADR·결정 로그 없음', '', 'ref'],
    ['block_dup', '└ 중복 코드', '', 'ref'],
    ['block_check', '└ 검사 실패·미실행', '', 'ref'],
    ['block_human', '└ 사람 확인 필요', '', 'ref'],
    ['block_other', '└ 그 밖 (비밀값·큰 파일 등)', '', 'ref'],
  ]],
  ['규모 (참고)', [
    ['code_lines', '코드', '줄 수', 'ref'],
    ['test_lines', '테스트 코드', '줄 수', 'ref'],
    ['code_files', '코드 파일 수', '큰 파일을 나누면 늘어남', 'ref'],
    ['commits_90d', `최근 ${COMMIT_WINDOW_DAYS}일 커밋`, '건수', 'ref'],
  ]],
];
const KEYS = GROUPS.flatMap(([, items]) => items.map(([k]) => k));
const COLUMNS = ['date', 'sha', 'backfill', ...KEYS];
const BLOCK_KINDS = [['TDD', 'tdd'], ['문서', 'docs'], ['ADR', 'adr'], ['결정 로그', 'adr'], ['중복', 'dup'], ['검사 ', 'check']];

const git = (root, args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
};
const listOf = (text) => (text || '').split('\n').filter(Boolean);
const lineCount = (root, f) => {
  const file = path.join(root, f);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size > MAX_SCAN_BYTES) return 0;
  const text = fs.readFileSync(file, 'utf8');
  return text.includes('\0') ? 0 : text.split('\n').length;
};
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Files touched per feature commit ("feat…" subject) in the window before `at` (unix sec).
function featMedian(root, at) {
  const out = git(root, ['log', '--no-merges', `--since=@${at - FEAT_WINDOW_DAYS * DAY_SEC}`, `--until=@${at}`, '--format=%x01%s', '--name-only', 'HEAD']);
  const counts = (out || '').split('\x01').filter(Boolean).flatMap((chunk) => {
    const [subject, ...files] = chunk.split('\n');
    return /^feat(\(|!|:)/.test(subject) ? [files.filter(Boolean).length] : [];
  });
  return median(counts);
}

function codeNumbers(root, tracked) {
  const code = tracked.filter((f) => CODE_EXT.test(f) && !OWN_FILES.test(f) && !/\.min\./.test(f));
  const tests = code.filter((f) => TEST_FILE.test(f));
  // Migrations (.sql) are not where same-name tests live; they would only skew the ratio.
  const prod = code.filter((f) => !TEST_FILE.test(f) && !/\.sql$/.test(f));
  const sizes = prod.map((f) => lineCount(root, f));
  const untested = prod.filter((f) => !relatedTests(root, [f], tracked).length).length;
  return {
    code_files: prod.length,
    code_lines: sizes.reduce((a, b) => a + b, 0),
    test_lines: tests.reduce((n, f) => n + lineCount(root, f), 0),
    files_over_800: sizes.filter((n) => n > MAX_FILE_LINES).length,
    largest_file_lines: Math.max(0, ...sizes),
    untested_pct: prod.length ? Math.round((untested / prod.length) * 1000) / 10 : null,
  };
}

function docNumbers(root, tracked) {
  const decisions = fs.existsSync(path.join(root, DECISIONS_FILE)) ? fs.readFileSync(path.join(root, DECISIONS_FILE), 'utf8') : '';
  return {
    root_files: tracked.filter((f) => !f.includes('/') && !f.startsWith('.') && !OWN_FILES.test(f)).length,
    dead_doc_links: deadLinkProblems(root, tracked).length,
    decision_lines: decisions.split('\n').filter((l) => /^\s*-\s+\S/.test(l)).length,
    adr_files: tracked.filter((f) => /^docs\/adr\/.+\.md$/.test(f)).length,
  };
}

// Stop blocks written by the hook (local, not committed) in the window before `at`.
function blockNumbers(root, at) {
  const file = path.join(root, STOP_LOG);
  const out = Object.fromEntries(KEYS.filter((k) => k.startsWith('block_') || k === 'stop_blocks_30d').map((k) => [k, 0]));
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e.at || e.at < at - BLOCK_WINDOW_DAYS * DAY_SEC || e.at > at) continue;
    out.stop_blocks_30d += 1;
    for (const [kind, n] of Object.entries(e.kinds || {})) out[`block_${kind}`] = (out[`block_${kind}`] || 0) + n;
  }
  return out;
}

// One measurement of the checked-out tree. `withBlocks` is false for past commits: the
// hook log only says what happened from now on.
function collect(root, { withBlocks = true } = {}) {
  const tracked = listOf(git(root, ['ls-files']));
  const at = Number(git(root, ['log', '-1', '--format=%ct', 'HEAD']).trim());
  const row = {
    sha: git(root, ['rev-parse', '--short', 'HEAD']).trim(),
    ...codeNumbers(root, tracked),
    ...docNumbers(root, tracked),
    duplicated_lines: duplicateStats(root).total,
    feat_median_files_60d: featMedian(root, at),
    commits_90d: Number(git(root, ['rev-list', '--count', `--since=@${at - COMMIT_WINDOW_DAYS * DAY_SEC}`, `--until=@${at}`, 'HEAD']).trim()),
  };
  return withBlocks ? { ...row, ...blockNumbers(root, Math.floor(Date.now() / 1000)) } : row;
}

// ---------- the history file ----------

function readRows(root) {
  const file = path.join(root, METRICS_FILE);
  if (!fs.existsSync(file)) return [];
  const [head, ...rest] = fs.readFileSync(file, 'utf8').trim().split('\n');
  const keys = head.split(',');
  return rest.filter(Boolean).map((l) => Object.fromEntries(l.split(',').map((v, i) => [keys[i], v === '' ? null : v])));
}

function writeRows(root, rows) {
  const extra = [...new Set(rows.flatMap(Object.keys))].filter((k) => !COLUMNS.includes(k));
  const cols = [...COLUMNS, ...extra];
  const body = rows.map((r) => cols.map((k) => (r[k] ?? '')).join(','));
  fs.mkdirSync(path.dirname(path.join(root, METRICS_FILE)), { recursive: true });
  fs.writeFileSync(path.join(root, METRICS_FILE), `${[cols.join(','), ...body].join('\n')}\n`);
}

const isoDate = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);

// Past weeks, measured in a clone that shares objects with the repository (read only);
// the repository and its working tree are never touched.
function backfill(root, weeks) {
  const head = Number(git(root, ['log', '-1', '--format=%ct', 'HEAD']).trim());
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-measure-'));
  const clone = path.join(tmp, 'repo');
  const rows = [];
  try {
    if (git(tmp, ['clone', '-q', '--shared', '--no-checkout', root, clone]) === null) throw new Error('임시 복제 실패');
    for (let w = weeks; w >= 1; w--) {
      const sha = (git(root, ['rev-list', '-1', `--before=@${head - w * 7 * DAY_SEC}`, 'HEAD']) || '').trim();
      if (!sha || rows.some((r) => sha.startsWith(r.sha))) continue;
      git(clone, ['checkout', '-q', '--force', sha]);
      const at = Number(git(clone, ['log', '-1', '--format=%ct', 'HEAD']).trim());
      rows.push({ date: isoDate(at), backfill: 1, ...collect(clone, { withBlocks: false }) });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return rows;
}

function measure(root, { weeks = 0, today = new Date().toISOString().slice(0, 10) } = {}) {
  const old = readRows(root);
  const known = new Set(old.map((r) => `${r.date} ${r.sha}`));
  const past = weeks ? backfill(root, weeks).filter((r) => !known.has(`${r.date} ${r.sha}`)) : [];
  const now = { date: today, ...collect(root) };
  const rows = [...old, ...past, now].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  writeRows(root, rows);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-report-'));
  const page = path.join(dir, 'report.html');
  fs.writeFileSync(page, require('./measure-page').page(path.basename(root), readRows(root), GROUPS));
  return { now, added: past.length + 1, page };
}

// ---------- Stop hook log ----------

function blockKinds(t) {
  const kinds = {};
  const add = (k) => { kinds[k] = (kinds[k] || 0) + 1; };
  for (const item of t.aiFix) add(BLOCK_KINDS.find(([p]) => item.startsWith(p))?.[1] || 'other');
  for (let i = 0; i < t.human.length; i++) add('human');
  return kinds;
}

function logStop(root, t) {
  const file = path.join(root, STOP_LOG);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ at: Math.floor(Date.now() / 1000), kinds: blockKinds(t) })}\n`);
}

module.exports = { measure, logStop, METRICS_FILE, GROUPS };
