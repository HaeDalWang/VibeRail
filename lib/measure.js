'use strict';

// `qh measure`: one row of numbers per measurement in .quality/metrics.csv (rows are never
// removed), and a local results page that shows first → now and each item's history.
// `--backfill <weeks>` also measures one commit per past week in a throwaway clone, so the
// page has a "before qh" stretch to compare with.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CODE_EXT, TEST_FILE, OWN_FILES, VENDORED, MAX_SCAN_BYTES, DECISIONS_FILE, relatedTests } = require('./policy');
const { duplicateStats, deadRefProblems, MAX_FILE_LINES } = require('./structure');

const METRICS_FILE = '.quality/metrics.csv';
// Bumped whenever what a number counts changes; rows are compared only within one version
// (a rule change must not show up as an improvement). 2 = ADR 0001, 3 = vendored code left out.
const RULES = 3;
const STOP_LOG = '.quality/evidence/stop-log.jsonl';
const DAY_SEC = 86400;
const FEAT_WINDOW_DAYS = 60;
const COMMIT_WINDOW_DAYS = 90;
const BLOCK_WINDOW_DAYS = 30;

// [key, label, note, direction, why]: 'lower' = fewer is better and is judged; 'ref' = shown
// for context only. `why` answers what it means, what gets worse, what gets better, and
// what is accepted (ADR 0001: an item that cannot answer these is not judged).
const GROUPS = [
  ['코드 구조', [
    ['files_over_800', `${MAX_FILE_LINES}줄 넘는 코드 파일`, '개수', 'lower', [
      '한 파일에 기능이 몰려 있다',
      '에이전트가 파일 전체를 읽어야 해 비용과 실수가 늘고, 한 곳을 고치다 옆 기능이 깨지며, 사람이 리뷰하기 어렵다',
      '고칠 때 영향 범위가 작아진다',
      '0이 목표는 아니다. 이미 큰 파일은 받아들이고, 작업이 그 파일을 더 키우면 qh가 막는다. 800은 연구 근거가 아닌 관례값이다',
    ]],
    ['duplicated_pct', '중복 코드 비율', '코드 줄 중 다른 곳에 같은 덩어리가 있는 줄(%)', 'lower', [
      '같은 로직이 여러 곳에 있다',
      '버그를 한 곳만 고치고 나머지에 남긴다(에이전트가 자주 한다)',
      '한 곳만 고치면 끝난다',
      '코드가 커지면 줄 수는 저절로 늘어나므로 비율로 본다. 0이 목표는 아니다. 둘이어야 하면 결정 로그에 `중복 허용: 파일 · 이유`를 쓰고, 그 파일은 여기서 빠진다. 한계: 이름만 바꿔 다시 쓴 코드는 못 잡아 실제보다 적게 센다',
    ]],
    ['duplicated_lines', '중복 코드 줄', '비율의 분자', 'ref'],
    ['flat_root_files', '정리 대상 폴더 맨 위 파일', '개수 · config structure.flatRoots 폴더 바로 아래, 폴더별 합', 'lower', [
      '하위 폴더로 나누기로 정한 폴더의 맨 위에 그냥 놓인 파일',
      '파일이 한 줄로 쌓여 어떤 기능이 어디 있는지 이름만으로 찾게 되고, 에이전트가 새 파일도 같은 자리에 계속 놓는다',
      '기능별 폴더를 열면 관련 파일이 모여 있다',
      '설정한 프로젝트에만 나온다. 새 파일은 qh가 막고, 기존 파일은 옮길 때마다 줄어든다. 꼭 맨 위여야 하면 결정 로그에 `루트 파일: 경로 · 이유`를 쓰고, 그 파일은 여기서 빠진다',
    ]],
  ]],
  ['테스트', [
    ['untested_pct', '테스트가 안 붙은 코드 파일', '비율(%) · 안전장치 없는 파일', 'lower', [
      'AI가 코드를 고쳤을 때 "진짜 잘 되는지" 자동으로 확인해 줄 테스트가 없는 파일',
      'AI가 수정을 거듭하다 다른 곳을 조용히 망가뜨려도, 직접 실행해 보기 전까지 모른다',
      '망가지면 그 자리에서 바로 알 수 있다',
      '0개일 필요는 없다(설정·타입 파일처럼 테스트가 필요 없는 파일도 있다). 그런 파일은 결정 로그에 `테스트 없음 허용: 파일 · 이유`를 한 줄 쓰면 여기서 빠진다. 파일 수가 늘어나므로 비율로 본다. 한계: 같은 이름의 테스트 파일이 있는지만 보고, 그 테스트가 꼼꼼한지는 모른다',
    ]],
  ]],
  ['문서와 결정', [
    ['dead_doc_links', '없는 파일을 가리키는 문서 링크', '개수', 'lower', [
      '문서에 "이 파일을 열어 보세요" 하고 걸어 둔 링크인데, 그 파일이 지워졌거나 없다',
      'AI나 나 자신이 문서를 믿고 찾아갔다가 엉뚱한 길로 빠져 흐름이 끊긴다',
      '문서를 믿고 따라갈 수 있다',
      '무조건 0개여야 한다. 없는 파일로 가는 링크는 언제나 오류라서 예외로 받아 주는 방법도 없다. 점(.)으로 시작하는 숨김 폴더(도구 설정·외부에서 가져온 사본)는 세지 않는다',
    ]],
    ['decision_lines', '결정 로그', '줄 수 · 많을수록 좋은 건 아니어서 판정하지 않음', 'ref'],
    ['adr_files', 'ADR', '개수 · 판정하지 않음', 'ref'],
  ]],
  ['개발 흐름 (참고)', [
    ['feat_median_files_60d', '기능 1건당 수정 파일 수', `최근 ${FEAT_WINDOW_DAYS}일 중앙값 · 커밋 습관에 흔들려 판정하지 않음`, 'ref'],
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
// Only in projects that set the config behind them: other projects' files and pages stay as they were.
const CONFIGURED = ['flat_root_files'];
const COLUMNS = ['date', 'sha', 'backfill', 'rules', ...KEYS.filter((k) => !CONFIGURED.includes(k))];
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

const decisionsOf = (root) => (fs.existsSync(path.join(root, DECISIONS_FILE)) ? fs.readFileSync(path.join(root, DECISIONS_FILE), 'utf8') : '');

function codeNumbers(root, tracked) {
  const decisions = decisionsOf(root).split('\n').filter((l) => l.includes('테스트 없음 허용'));
  const code = tracked.filter((f) => CODE_EXT.test(f) && !OWN_FILES.test(f) && !VENDORED.test(f) && !/\.min\./.test(f));
  const tests = code.filter((f) => TEST_FILE.test(f));
  // Migrations (.sql) are not where same-name tests live; they would only skew the ratio.
  const prod = code.filter((f) => !TEST_FILE.test(f) && !/\.sql$/.test(f));
  const sizes = prod.map((f) => lineCount(root, f));
  const needTests = prod.filter((f) => !decisions.some((l) => l.includes(f)));
  const untested = needTests.filter((f) => !relatedTests(root, [f], tracked).length).length;
  return {
    code_files: prod.length,
    code_lines: sizes.reduce((a, b) => a + b, 0),
    test_lines: tests.reduce((n, f) => n + lineCount(root, f), 0),
    files_over_800: sizes.filter((n) => n > MAX_FILE_LINES).length,
    untested_pct: needTests.length ? Math.round((untested / needTests.length) * 1000) / 10 : null,
  };
}

// Dot folders hold tool settings and copied-in skills, not the project's own documents.
const isOwnDoc = (f) => !f.startsWith('.');

// Files directly under the folders the project set to be split by feature, minus declared exceptions.
function flatRootFiles(root, tracked, dirs) {
  const allowed = decisionsOf(root).split('\n').filter((l) => l.includes('루트 파일'));
  const roots = new Set(dirs.map((d) => d.replace(/\/+$/, '')));
  return tracked.filter((f) => roots.has(path.posix.dirname(f)) && !allowed.some((l) => l.includes(f))).length;
}

function docNumbers(root, tracked, structure) {
  const decisions = decisionsOf(root);
  return {
    dead_doc_links: deadRefProblems(root, tracked.filter(isOwnDoc), structure).length,
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
// `structure` is today's config, also for past commits, so a row's numbers do not jump the
// day the config came in.
function collect(root, { withBlocks = true, structure = {} } = {}) {
  const tracked = listOf(git(root, ['ls-files']));
  const at = Number(git(root, ['log', '-1', '--format=%ct', 'HEAD']).trim());
  const row = {
    sha: git(root, ['rev-parse', '--short', 'HEAD']).trim(),
    rules: RULES,
    ...codeNumbers(root, tracked),
    ...docNumbers(root, tracked, structure),
    ...(structure.flatRoots ? { flat_root_files: flatRootFiles(root, tracked, structure.flatRoots) } : {}),
    // .sql is left out like in code_lines, so the share has the same base.
    duplicated_lines: duplicateStats(root).perFile.filter(([f]) => !/\.sql$/.test(f)).reduce((n, [, c]) => n + c, 0),
    feat_median_files_60d: featMedian(root, at),
    commits_90d: Number(git(root, ['rev-list', '--count', `--since=@${at - COMMIT_WINDOW_DAYS * DAY_SEC}`, `--until=@${at}`, 'HEAD']).trim()),
  };
  return withBlocks ? { ...row, ...blockNumbers(root, Math.floor(Date.now() / 1000)) } : row;
}

// The share is derived, so rows written before it existed get it too.
const withShares = (r) => (r.duplicated_pct == null && r.duplicated_lines != null && Number(r.code_lines)
  ? { ...r, duplicated_pct: Math.round((Number(r.duplicated_lines) / Number(r.code_lines)) * 10000) / 100 }
  : r);

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

// Past weeks, plus the commit right before qh came in (the baseline the page judges from),
// measured in a clone that shares objects with the repository (read only); the repository
// and its working tree are never touched.
function backfill(root, weeks, structure) {
  const head = Number(git(root, ['log', '-1', '--format=%ct', 'HEAD']).trim());
  const weekly = Array.from({ length: weeks }, (_, i) => (git(root, ['rev-list', '-1', `--before=@${head - (weeks - i) * 7 * DAY_SEC}`, 'HEAD']) || '').trim());
  const installed = installCommit(root);
  const beforeQh = installed && (git(root, ['rev-parse', '-q', '--verify', `${installed}^`]) || '').trim();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-measure-'));
  const clone = path.join(tmp, 'repo');
  const rows = [];
  try {
    if (git(tmp, ['clone', '-q', '--shared', '--no-checkout', root, clone]) === null) throw new Error('임시 복제 실패');
    for (const sha of [...weekly, beforeQh]) {
      if (!sha || rows.some((r) => sha.startsWith(r.sha))) continue;
      git(clone, ['checkout', '-q', '--force', sha]);
      const at = Number(git(clone, ['log', '-1', '--format=%ct', 'HEAD']).trim());
      rows.push({ date: isoDate(at), backfill: 1, ...collect(clone, { withBlocks: false, structure }) });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return rows;
}

// The commit that first added qh to the project; rows from it on are "with qh", so the page
// can say what changed since qh came in, apart from the trend before it.
function installCommit(root) {
  return listOf(git(root, ['log', '--diff-filter=A', '--format=%H', 'HEAD', '--', '.quality/qh/bin/qh.js'])).pop() || null;
}
const isAncestor = (root, a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: root }).status === 0;

function measure(root, { weeks = 0, today = new Date().toISOString().slice(0, 10) } = {}) {
  const old = readRows(root);
  const id = (r) => `${r.date} ${r.sha} ${r.rules || 1}`;
  const known = new Set(old.map(id));
  let structure = {};
  try { structure = JSON.parse(fs.readFileSync(path.join(root, '.quality/config.json'), 'utf8')).structure || {}; } catch { /* no config: defaults */ }
  const past = weeks ? backfill(root, weeks, structure).filter((r) => !known.has(id(r))) : [];
  const now = { date: today, ...collect(root, { structure }) };
  const rows = [...old, ...past, now].map(withShares).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  writeRows(root, rows);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-report-'));
  const page = path.join(dir, 'report.html');
  const installed = installCommit(root);
  const marked = readRows(root).map((r) => ({ ...r, withQh: Boolean(installed && r.sha && isAncestor(root, installed, r.sha)) }));
  const shown = GROUPS.map(([g, items]) => [g, items.filter(([k]) => !CONFIGURED.includes(k) || marked.some((r) => r[k] != null))]);
  fs.writeFileSync(page, require('./measure-page').page(path.basename(root), marked, shown));
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
