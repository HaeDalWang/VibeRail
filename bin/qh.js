#!/usr/bin/env node
'use strict';

// qh: run checks, bind each result to the working-tree state it ran on, and gate
// agent turns (Stop hook) and PRs on that evidence.
// Installed per project under .quality/qh/ by `qh init`; project specifics live in
// .quality/config.json, .quality/access.json and .quality/probe.mjs.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { doctor, formatDoctor } = require('../lib/doctor');
const { policyProblems, relatedTests, loadLimits, LIMITS, DECISIONS_FILE } = require('../lib/policy');
const { structureFindings, duplicateTotal } = require('../lib/structure');
const { codeShapeProblems, ToolMissing } = require('../lib/code-shape');
const repoTools = require('../lib/repo-tools');
const stopState = require('../lib/stop-state');
const { allowedFailures, failureScope, isAllowedFailure, baselineFailures } = require('../lib/failing-tests');
const { formatStatus } = require('../lib/status-format');
const waivers = require('../lib/waivers');
const { answerState, decisions } = require('../lib/card');
const routesBaseline = require('../lib/routes-baseline');
const { shellQuote, fillReviewCmd } = require('../lib/shell-words');

const redCheck = require('../lib/red-check');
const runEnvError = (root, def, ev, log) => require('../lib/run-env-error').runEnvError(root, def, ev, log, { git, treeHash });

const QH_HOME = path.join(__dirname, '..');
const EVIDENCE_DIR = '.quality/evidence';
const CONFIG_FILE = '.quality/config.json';
const PROBE_FILE = '.quality/probe.mjs';
const { triage, answerChangeUser, aiFixUser, aiFixKind, criteriaWords, criteriaUser, ACCESS_FILE } = require('../lib/triage');
const { METRICS_FILE, REPORTS_DIR } = require('../lib/measure');
const PHASES = ['stop', 'pr'];
const MAX_LISTED_CHANGES = 10;
const DEFAULT_TIMEOUT_SEC = 300;
// Stop runs built-in checks inside the host's 120-second hook limit (lib/init.js).
const BUILTIN_TIMEOUT_SEC = 90;
const DEFAULT_REVIEW_TIMEOUT_SEC = 900;
const MAX_BUFFER = 64 * 1024 * 1024;
const EXIT = { ok: 0, failed: 1, env: 3 };

class EnvError extends Error {}

// ---------- git ----------

function git(root, args, env) {
  // quotepath off: a Korean file name comes back as written, not as "\354\204…".
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, encoding: 'utf8', env: env || process.env, maxBuffer: MAX_BUFFER });
  if (r.status !== 0) throw new EnvError(`git ${args.join(' ')}: ${(r.stderr || '').trim()}`);
  return r.stdout.trim();
}

function findRoot(cwd) {
  try {
    return git(cwd, ['rev-parse', '--show-toplevel']);
  } catch {
    throw new EnvError('git 저장소가 아니다');
  }
}

// Tree of the working state, untracked files included, via a throwaway index so the
// user's index is never touched. Evidence files are excluded or every write would
// invalidate every other result.
const coverage = require('../lib/coverage');
const treeHash = (root) => coverage.treeHash(root, git);

// Git prints nothing when the two have no common ancestor: in CI that is a shallow clone.
function mergeBase(root, ref) {
  try {
    return require('../lib/base-commit').workBase(root, git, ref, git(root, ['merge-base', ref, 'HEAD']));
  } catch (err) {
    if (!/: $/.test(err.message)) throw err;
    throw Object.assign(new EnvError(`git merge-base ${ref} HEAD: 공통 조상이 없다 (shallow clone이면 \`git fetch --unshallow\`)`), {
      user: '품질 검사를 하지 못했습니다. 비교할 기준 브랜치와 이어지는 기록이 이 컴퓨터에 다 받아져 있지 않습니다. 기록을 전부 내려받으면 다시 검사합니다. 코드는 바꾸지 않았습니다.',
    });
  }
}

function lines(text) {
  return text.split('\n').filter(Boolean);
}

function changedFiles(root, base) {
  const files = new Set([
    ...lines(git(root, ['diff', '--name-only', base])),
    ...lines(git(root, ['ls-files', '--others', '--exclude-standard'])),
  ]);
  // Same exclusions as treeHash: qh's own records are not part of the work.
  return [...files].filter((f) => !f.startsWith(`${EVIDENCE_DIR}/`) && f !== METRICS_FILE && !f.startsWith(`${REPORTS_DIR}/`)).sort();
}

// ---------- config & evidence ----------

function loadConfig(root) {
  const file = path.join(root, CONFIG_FILE);
  if (!fs.existsSync(file)) throw new EnvError(`${CONFIG_FILE} 없음`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw Object.assign(new EnvError(`${CONFIG_FILE}이 JSON 형식이 아니다: ${err.message} → 코드를 고치지 말고 사용자에게 보고 (설정 파일은 사용자 확인 없이 고치지 않는다)`), {
      user: '품질 검사 설정 파일이 깨져 있어 검사를 못 했습니다. 설정 파일을 고칠지 정해 주세요. 고치기 전까지는 검사하지 않습니다.',
    });
  }
}

function evidencePath(root, name) {
  return path.join(root, EVIDENCE_DIR, `${name}.json`);
}

function readEvidence(root, name) {
  // A record cut off mid-write counts as not run: the next run overwrites it.
  const file = evidencePath(root, name);
  return fs.existsSync(file) ? parseJson(fs.readFileSync(file, 'utf8')) : null;
}

function writeEvidence(root, name, data) {
  fs.mkdirSync(path.join(root, EVIDENCE_DIR), { recursive: true });
  fs.writeFileSync(evidencePath(root, name), `${JSON.stringify(data, null, 2)}\n`);
}

// ---------- environment & requirements ----------

const NO_COMMIT = '커밋 없음: 이 저장소에 아직 커밋이 없어 비교할 기준이 없다 → 사용자에게 알리고, 원하면 첫 커밋을 만든다. 첫 커밋 뒤부터 판정한다';
const hasCommit = (root) => spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { cwd: root }).status === 0;

function envProblems(root, config) {
  const problems = doctor(root, { light: true }).map((p) => `설정: ${p.msg} → ${p.fix}`);
  if (problems.length) return problems;
  if (!hasCommit(root)) return [NO_COMMIT];
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `${config.baseRef}^{commit}`]);
  } catch {
    problems.push(`기준 ref "${config.baseRef}"가 이 저장소에 없다 (fetch 필요 또는 config.baseRef 확인)`);
  }
  return problems;
}

// A check runs in the phases listed in its `on` (default: both). PR-only checks are
// the slow ones (a test database); Stop neither runs nor demands them.
const runsIn = (def, phase) => (def?.on || PHASES).includes(phase);

const TESTS_SLOT = '{tests}';
const workTests = (root, changed) => relatedTests(root, changed, lines(git(root, ['ls-files'])));

function requirements(config, changed, phase, root) {
  if (changed.length === 0) return { names: [], later: [], risks: [], docsMissing: [] };
  const names = new Set(config.common || []);
  const risks = [];
  const docsMissing = [];
  for (const [risk, def] of Object.entries(config.risks || {})) {
    const files = changed.filter((f) => def.paths.some((p) => path.matchesGlob(f, p)));
    if (files.length === 0) continue;
    risks.push({ risk, files });
    for (const c of def.checks || []) names.add(c);
    for (const doc of def.docs || []) if (!changed.includes(doc)) docsMissing.push({ risk, doc });
  }
  const all = [...names];
  // A "{tests}" check with no test of this work to run has nothing to prove.
  const hasTests = all.some((n) => config.checks?.[n]?.cmd?.includes(TESTS_SLOT)) && workTests(root, changed).length > 0;
  const isEmptySlot = (n) => config.checks?.[n]?.cmd?.includes(TESTS_SLOT) && !hasTests;
  const now = all.filter((n) => !isEmptySlot(n) && (!config.checks?.[n] || runsIn(config.checks[n], phase)));
  return { names: now, later: all.filter((n) => !now.includes(n) && !isEmptySlot(n)), risks, docsMissing };
}

// ---------- running checks ----------

// The command word the shell runs: past VAR=value prefixes, without its quotes.
const COMMAND_WORD = /^\s*(?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S*)\s+)*(?:"([^"]+)"|'([^']+)'|(\S+))/;

function toolExists(root, cmd) {
  const m = cmd.match(COMMAND_WORD);
  const tool = m && (m[1] || m[2] || m[3]);
  if (!tool || tool.includes('$')) return null; // only the shell can resolve it; let the run say
  const r = spawnSync('sh', ['-c', 'command -v "$1" >/dev/null', '_', tool], { cwd: root });
  return r.status === 0 ? null : tool;
}

function spawnCheck(root, def, timeoutSec, env = process.env) {
  const opts = { cwd: root, env, encoding: 'utf8', timeout: timeoutSec * 1000, maxBuffer: MAX_BUFFER };
  if (def.builtin) {
    const runner = path.join(QH_HOME, 'lib', 'run-builtin.js');
    return spawnSync(process.execPath, [runner, def.builtin, root, JSON.stringify(def)], opts);
  }
  return spawnSync('sh', ['-c', def.cmd], opts);
}

function runCheck(root, name, check) {
  if (!check) throw new EnvError(`config에 없는 검사: ${name}`);
  let def = check;
  if (check.cmd?.includes(TESTS_SLOT)) {
    const base = mergeBase(root, loadConfig(root).baseRef);
    def = { ...check, cmd: check.cmd.replaceAll(TESTS_SLOT, workTests(root, changedFiles(root, base)).map(shellQuote).join(' ')) };
  }
  const hash = treeHash(root);
  const timeoutSec = def.timeoutSec || (def.builtin ? BUILTIN_TIMEOUT_SEC : DEFAULT_TIMEOUT_SEC);
  const base = { check: name, cmd: def.cmd || `builtin:${def.builtin}`, treeHash: hash, timeoutSec, startedAt: new Date().toISOString() };
  const missing = def.builtin ? null : toolExists(root, def.cmd);
  if (missing) return writeEvidence(root, name, { ...base, envError: `도구 없음: ${missing}`, envKind: 'tool' });

  const r = coverage.run(root, def, hash, () => treeHash(root), (env) => spawnCheck(root, def, timeoutSec, env), name);
  const logPath = path.join(EVIDENCE_DIR, `${name}.log`);
  fs.mkdirSync(path.join(root, EVIDENCE_DIR), { recursive: true });
  const log = `${r.stdout || ''}${r.stderr || ''}`;
  fs.writeFileSync(path.join(root, logPath), log);
  const timedOut = r.error?.code === 'ETIMEDOUT';
  const evidence = { ...base, exit: timedOut ? 124 : (r.status ?? 1), timedOut, finishedAt: new Date().toISOString(), logPath };
  if (def.builtin) evidence.result = parseJson(r.stdout);
  writeEvidence(root, name, { ...evidence, ...runEnvError(root, def, evidence, log) });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------- assessment ----------

function checkStatus(root, name, now) {
  const ev = readEvidence(root, name);
  if (!ev) return { name, state: '미실행' };
  if (ev.envError) return { name, state: '환경 오류', envKind: ev.envKind, detail: [ev.envError] };
  // A slow suite is not a code bug: the agent must not "fix" tests to make them faster.
  if (ev.timedOut) return { name, state: '환경 오류', envKind: 'timeout', detail: [`시간 초과 (로그: ${ev.logPath}) → 테스트를 고치지 말고 사용자에게: 이 검사의 timeoutSec를 늘리거나, 오래 걸리면 on을 ["pr"]로`] };
  const isCurrent = ev.treeHash === now;
  const detail = describeResult(ev);
  if (ev.exit !== 0) return { name, state: '실패', isCurrent, detail, logPath: ev.logPath, ...failureScope(root, name, ev.logPath) };
  return { name, state: isCurrent ? '통과' : '이전 상태에서 통과', isCurrent, detail, result: ev.result };
}

function describeResult(ev) {
  const r = ev.result;
  if (!r) return ev.exit === 0 ? [] : [ev.timedOut ? '시간 초과' : `exit ${ev.exit} (로그: ${ev.logPath})`];
  if (r.error) return [`검사를 실행하지 못함: ${r.error.split('\n')[0]}`];
  const out = (r.failures || []).map((f) => {
    if (f.reason === 'stale') return `${f.route}: config에는 있지만 앱에 없는 라우트`;
    if (f.reason === 'allowed') return `${f.route}: ${f.as} 권한 요청이 ${f.status}로 허용됨 (권한 확인 누락)`;
    return `${f.file}:${f.line} ${f.error}`;
  });
  if (r.unchecked?.length) out.push(`(참고) SQL ${r.unchecked.length}개는 동적이라 검사 못 함`);
  if (r.inconclusive?.length) out.push(`(참고) 라우트 ${r.inconclusive.length}건은 판정 불가(${r.inconclusive.map((i) => `${i.route}→${i.status}`).join(', ')})`);
  return out;
}

// On a branch the card is named after it; detached (CI PR checkouts), it is the card this work changed.
function taskCard(root, base) {
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const rel = branch === 'HEAD'
    ? changedFiles(root, base || mergeBase(root, loadConfig(root).baseRef)).find((f) => f.startsWith('.quality/tasks/') && f.endsWith('.md')) || path.join('.quality', 'tasks', 'HEAD.md')
    : path.join('.quality', 'tasks', `${branch}.md`);
  const file = path.join(root, rel);
  return { rel, text: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' };
}

// Only `- [ ] ` items reach the person; a plain list item there would be silently skipped.
function cardFormatProblems(card) {
  const { plain } = decisions(card.text);
  if (!plain.length) return [];
  return [`작업 카드: ${card.rel} \`## 판단 필요\`에 체크박스 없는 항목이 있어 사람 확인으로 잡히지 않는다 → 사람이 정할 것이면 \`- [ ] 항목\`으로 바꿔 사용자에게 묻고, 아니면 다른 절로 옮긴다: ${plain.map((x) => `"${x}"`).join(', ')}`];
}

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = JSON.stringify(v);
  }
  return out;
}

function readJsonAt(root, rev, file) {
  try {
    return rev ? JSON.parse(git(root, ['show', `${rev}:${file}`])) : JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  } catch {
    return {};
  }
}

// In words a non-developer can answer "is this what you want?" about.
const criteriaSummary = (root, config) => criteriaWords(config, Object.keys(readJsonAt(root, null, ACCESS_FILE).routes || {}).length);

// What the gate measures against (checks, risks, the access table) changed in this work.
// A person who confirmed this exact version (qh confirm) is not asked again.
function configChanges(root, base, config, card) {
  const isFirstInstall = !git(root, ['ls-tree', '--name-only', base, CONFIG_FILE]);
  // The person's answer is the card line for this question (lib/waivers.js); an unchecked line is an open decision.
  const state = answerState(card, criteriaUser({ isFirstInstall, summary: criteriaSummary(root, config) }));
  if (state === 'open' || (state === 'yes' && waivers.isCriteriaRecorded(root))) return [];
  const confirm = '사용자가 답하면 작업 카드 `## 판단 필요`에 `- [x] <Tell the user 문장 그대로> · <답>`을 쓰고 `qh confirm` 실행';
  const diffHint = `\`git diff ${base.slice(0, 7)} -- ${CONFIG_FILE} ${ACCESS_FILE}\`로 확인. ${confirm}`;
  if (isFirstInstall) return [`qh 첫 설치: 품질 검사 설정이 새로 생겼다. 사용자에게 쉬운 말로 이대로 쓸지 묻는다 (${criteriaSummary(root, config)}). ${confirm}`];
  // baseRef is where to compare from, not what is checked (`status --base` overrides it).
  const a = flatten({ ...readJsonAt(root, base, CONFIG_FILE), baseRef: undefined, access: readJsonAt(root, base, ACCESS_FILE) });
  const b = flatten({ ...config, baseRef: undefined, access: readJsonAt(root, null, ACCESS_FILE) });
  // A route qh asked "who may open it?" about, added to a table the base already had, is the person's answer.
  const hadTable = Boolean(readJsonAt(root, base, ACCESS_FILE).routes);
  const asked = stopState.askedRoutes(root);
  const isAnswer = (k) => hadTable && a[k] === undefined && asked.has(k.replace(/^access\.routes\./, '').replace(/\.(level|check)$/, ''));
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k] && !isAnswer(k)).sort();
  // `qh answer` writes choice, date and reason per question: one item per question, said by what it became.
  const answered = [...new Set(keys.filter((k) => k.startsWith('answers.')).map((k) => k.split('.')[1]))];
  const answerItems = answered.flatMap((id) => {
    const choice = b[`answers.${id}.choice`]?.replaceAll('"', '');
    const state = answerState(card, answerChangeUser(id, choice));
    return state === 'open' || (state === 'yes' && waivers.isCriteriaRecorded(root)) ? [] : [`answers.${id}: ${choice ?? '(삭제)'} (이전 ${a[`answers.${id}.choice`]?.replaceAll('"', '') ?? '(없음)'}). ${confirm}`];
  });
  const rest = keys.filter((k) => !k.startsWith('answers.'));
  if (rest.length > MAX_LISTED_CHANGES) {
    // A first baseline adds hundreds of routes: one line per section, read it in the diff.
    const sections = Map.groupBy(rest, (k) => k.split('.').slice(0, 2).join('.'));
    return [...answerItems, ...[...sections].map(([section, ks]) => `${section}: ${ks.length}개 항목 바뀜 → ${diffHint}`)];
  }
  return [...answerItems, ...rest.map((k) => `${k}: ${a[k] ?? '(없음)'} → ${b[k] ?? '(삭제)'}`), ...repoTools.baselineChanges(root, base)];
}

// Whole-repository tools take seconds to minutes; `qh pr` assesses three times on one tree.
const repoToolRuns = new Map();
function repoToolResult(root, tree, structure) {
  if (!repoToolRuns.has(tree)) repoToolRuns.set(tree, repoTools.repoToolProblems(root, structure));
  return repoToolRuns.get(tree);
}

// Structure ratchet: file-local checks on the changed files every time; repository-wide tools at PR only.
function structureResult(root, { changed, base, phase, tree, structure }) {
  if (!changed.length) return { problems: [], warnings: [], env: [] };
  const shape = codeShapeProblems(root, { changed, base, structure });
  const repo = phase === 'pr' ? repoToolResult(root, tree, structure) : { problems: [], env: [] };
  const own = structureFindings(root, { changed, base, structure });
  return { problems: [...own.problems, ...shape.problems, ...repo.problems], warnings: own.warnings, skipped: shape.skipped, env: [...shape.env, ...repo.env] };
}

// The person answered "검토 생략" (C): no AI review, nothing to run.
const isReviewSkipped = (root, config) => require('../lib/questions').effectiveAnswers(root, config)?.reviewer === 'C';

function reviewStatus(root, now, config) {
  if (isReviewSkipped(root, config)) return { state: '생략 (사용자가 검토 생략을 고름)' };
  const ev = readEvidence(root, 'review');
  if (!ev) return { state: '미실행' };
  if (ev.envError) return { state: '환경 오류', detail: [ev.envError] };
  return { state: ev.treeHash === now ? '완료' : '이전 상태에서 완료', findings: ev.findings };
}

// baseRef: compare against this ref instead of config.baseRef (a CI run that knows the merge target).
function assess(root, phase = 'stop', baseRef) {
  const config = baseRef ? { ...loadConfig(root), baseRef } : loadConfig(root);
  const env = envProblems(root, config);
  const now = treeHash(root);
  const out = { treeHash: now, baseRef: config.baseRef, phase, env, checks: [], allowedFailures: [], later: [], risks: [], docsMissing: [], policy: [], structure: [], decisions: [], waivers: [], taskQuestions: [], undeclared: [], configChanges: [], review: { state: '미실행' } };
  if (env.length) return { config, ...out };
  const base = mergeBase(root, config.baseRef);
  const changed = changedFiles(root, base);
  const req = requirements(config, changed, phase, root);
  const checks = req.names.map((n) => (config.checks?.[n] ? checkStatus(root, n, now) : { name: n, state: '실패', detail: ['config.checks에 정의가 없다'] }));
  const undeclared = [...new Set(checks.filter((c) => c.isCurrent && c.result?.undeclared).flatMap((c) => c.result.undeclared))];
  const card = taskCard(root, base);
  const specGate = require('../lib/spec-check').gate(root, card);
  const red = phase === 'pr' ? redCheck.readRedCheck(root, now) : null;
  const criteria = changed.length ? configChanges(root, base, config, card.text) : [];
  const shape = structureResult(root, { changed, base, phase, tree: now, structure: config.structure });
  return {
    config,
    ...out,
    base,
    changed,
    checks,
    redCheck: red,
    allowedFailures: allowedFailures(root),
    later: req.later,
    risks: req.risks,
    docsMissing: req.docsMissing,
    policy: [
      ...(red?.state === '막음' ? [`TDD RED: ${redCheck.BLOCK} → 기준 코드에서 실패하는 테스트를 추가한다`] : []),
      ...(changed.length ? policyProblems(root, { changed, risks: req.risks, isCriteriaChanged: criteria.length > 0, card: card.text, cardPath: card.rel, base, answers: require('../lib/questions').effectiveAnswers(root, config) }) : []),
      ...cardFormatProblems(card),
      ...require('../lib/spec-check').shapeProblems(root, card),
      ...specGate.agent,
      ...(phase === 'pr' ? require('../lib/history-secrets').historySecretProblems(root, base) : []),
    ],
    structure: shape.problems,
    structureEnv: shape.env,
    structureWarnings: shape.warnings,
    shapeSkipped: shape.skipped,
    policyWarnings: changed.length ? require('../lib/glossary-check').glossaryWarnings(root, { changed, base }) : [],
    decisions: decisions(card.text).open,
    waivers: [...waivers.pendingWaivers(root, { card: card.text, changed }), ...specGate.person, ...require('../lib/confirm').pendingConfirms(root, { card: card.text, isSpecChecked: specGate.passed })],
    taskQuestions: require('../lib/questions').pendingTaskQuestions(req.risks, card.text),
    undeclared,
    accessLevels: readJsonAt(root, null, ACCESS_FILE).levels || [],
    accessLabels: readJsonAt(root, null, ACCESS_FILE).labels,
    configChanges: criteria,
    criteria: { isFirstInstall: !git(root, ['ls-tree', '--name-only', base, CONFIG_FILE]), summary: criteriaSummary(root, config) },
    review: reviewStatus(root, now, config),
  };
}

// ---------- review ----------

function runReview(root, config, baseArg) {
  if (isReviewSkipped(root, config)) {
    console.log('AI 리뷰: 사용자가 검토 생략을 골라 돌리지 않았다');
    // The skip never needed a base; without one there is simply no page.
    let skipBase;
    try { skipBase = mergeBase(root, baseArg || config.baseRef); } catch { return EXIT.ok; }
    return reviewPage(root, config, skipBase, null);
  }
  if (!config.review?.cmd) throw new EnvError('config.review.cmd 없음');
  const base = mergeBase(root, baseArg || config.baseRef);
  const hash = treeHash(root);
  const outDir = path.join(root, EVIDENCE_DIR, 'review');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  // The reviewer judges against what the person agreed (card, spec), not the author's own account (commit messages).
  const diffFile = path.join(outDir, 'change.diff');
  fs.writeFileSync(diffFile, `${git(root, ['diff', base, hash])}\n`);
  const card = taskCard(root, base);
  const spec = (card.text.match(/^명세:\s*`?([^`\n]+?)`?\s*$/m) || [])[1] || '없음';
  const taskFile = path.join(outDir, 'task.md');
  const fill = (s) => s.replaceAll('{{ROOT}}', root).replaceAll('{{DIFF}}', diffFile).replaceAll('{{OUT}}', outDir).replaceAll('{{BASE}}', base).replaceAll('{{CARD}}', card.text ? card.rel : '없음').replaceAll('{{SPEC}}', spec);
  fs.writeFileSync(taskFile, fill(fs.readFileSync(path.join(QH_HOME, 'lib', 'review-task.md'), 'utf8')));

  const cmd = fillReviewCmd(config.review.cmd, { workdir: root, task: taskFile, out: outDir });
  const evidence = { check: 'review', cmd, treeHash: hash, base, startedAt: new Date().toISOString() };
  const missing = toolExists(root, cmd);
  if (missing) return writeEvidence(root, 'review', { ...evidence, envError: `도구 없음: ${missing}` }) || EXIT.env;
  const started = Date.now();
  const r = spawnSync('sh', ['-c', cmd], { cwd: root, encoding: 'utf8', timeout: (config.review.timeoutSec || DEFAULT_REVIEW_TIMEOUT_SEC) * 1000, maxBuffer: MAX_BUFFER });
  fs.writeFileSync(path.join(outDir, 'run.log'), `${r.stdout || ''}${r.stderr || ''}`);
  const findings = readFindings(path.join(outDir, 'result.json'));
  const done = { ...evidence, exit: r.status ?? 124, elapsedSec: Math.round((Date.now() - started) / 1000), logPath: path.join(EVIDENCE_DIR, 'review', 'run.log') };
  if (!findings || done.exit !== 0) {
    const why = findings ? (done.exit === 124 ? '리뷰가 시간 초과로 멈춤' : '리뷰가 정상 종료하지 않음') : '리뷰 결과(result.json)가 없거나 형식이 틀림';
    writeEvidence(root, 'review', { ...done, envError: `${why} (exit ${done.exit}, 로그 ${done.logPath})` });
    return EXIT.env;
  }
  writeEvidence(root, 'review', { ...done, findings });
  return reviewPage(root, config, base, findings);
}

function reviewPage(root, config, base, findings) {
  const level = config.answers?.level?.choice === 'B' ? 'B' : 'A';
  const file = require('../lib/review-page').writeReviewPage(root, { base, treeHash: treeHash(root), level, card: taskCard(root, base).text, changed: changedFiles(root, base), checks: Object.keys(config.checks || {}), findings });
  console.log(`완료 리뷰 화면: ${file}\n◆③ 때 사용자에게 경로를 주지 말고 ${require('../lib/view').OPEN_HINT}.`);
  return EXIT.ok;
}

function readFindings(file) {
  const data = fs.existsSync(file) ? parseJson(fs.readFileSync(file, 'utf8')) : null;
  if (!Array.isArray(data)) return null;
  const isValid = (f) => f && typeof f.file === 'string' && Number.isInteger(f.line) && typeof f.reason === 'string';
  return data.every(isValid) ? data : null;
}

// ---------- commands ----------

function cmdCheck(root, names, { builtinOnly = false, phase = 'stop' } = {}) {
  const config = loadConfig(root);
  const env = envProblems(root, config);
  if (env.length) {
    console.log(['환경 오류 (코드를 고치지 말고 사용자에게 보고)', ...env.map((e) => `  - ${e}`)].join('\n'));
    return EXIT.env;
  }
  const a = assess(root, phase);
  let targets = names.length ? names : a.checks.map((c) => c.name);
  // Stop (builtinOnly) has the host's time limit: a built-in check already bound to this tree is not rerun.
  if (builtinOnly) targets = targets.filter((n) => config.checks?.[n]?.builtin && !a.checks.find((c) => c.name === n)?.isCurrent);
  for (const n of targets) runCheck(root, n, config.checks?.[n]);
  const after = assess(root, phase);
  if (!builtinOnly) console.log(formatStatus(after));
  const isAllowed = (c) => isAllowedFailure(c, after.allowedFailures);
  const failing = after.checks.filter((c) => targets.includes(c.name) && c.state !== '통과' && !isAllowed(c));
  if (!failing.length) return EXIT.ok;
  return failing.every((c) => c.state === '환경 오류') ? EXIT.env : EXIT.failed;
}

// Doctor failures only a person may settle (files the agent must not change without asking).
function formatSetup(setup) {
  const human = setup.filter((p) => p.isHuman && p.level === '실패');
  const rest = setup.filter((p) => !human.includes(p));
  const ask = human.length ? `\nqh doctor: 사용자에게 보고 (사람이 정할 설정, 에이전트가 고치지 않는다)\n${human.map((p) => `  - ${p.msg} → ${p.fix}`).join('\n')}` : '';
  return `${formatDoctor(rest)}${ask}`;
}

// What stops a PR: the same list for `qh pr` and `qh status --pr` (CI). The review run is `qh pr`'s own.
function isPrBlocked(a, t, setup) {
  const isEnvCheck = a.checks.some((c) => c.state === '환경 오류');
  return Boolean(t.aiFix.length || a.undeclared.length || a.decisions.length || a.waivers.length || a.taskQuestions.length || t.env.length || isEnvCheck || setup.some((p) => p.level === '실패'));
}

function cmdPr(root) {
  if (envProblems(root, loadConfig(root)).length) return cmdCheck(root, [], { phase: 'pr' });
  cmdCheck(root, [], { phase: 'pr' });
  const before = assess(root, 'pr');
  redCheck.runRedCheck(root, { ...before, card: taskCard(root, before.base).text, tests: workTests(root, before.changed) }, { git, hashTree: treeHash, spawnCheck, runEnvError });
  const reviewExit = runReview(root, loadConfig(root));
  const a = assess(root, 'pr');
  const t = triage(a);
  const setup = doctor(root);
  const declared = waivers.declaredWaivers(taskCard(root, a.base).text, root, a.changed);
  console.log(`\n${formatStatus(a)}\n${formatSetup(setup)}\n${duplicateTotal(root)}${declared.length ? `\n에이전트가 작업 카드에서 면제한 것 (리뷰어 확인):\n${declared.map((d) => `  - ${d}`).join('\n')}` : ''}`);
  const isBlocked = isPrBlocked(a, t, setup) || reviewExit !== EXIT.ok;
  // Only a full qh pr pass (checks and the AI review) is where the next work on the base branch starts.
  if (!isBlocked && git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'HEAD') stopState.markPassed(root, git(root, ['rev-parse', 'HEAD']));
  const found = a.review.findings || [];
  const open = `AI 리뷰 지목 ${found.length}건(높음 ${found.filter((f) => f.severity === '높음').length}건)과 기준 변경 ${a.configChanges.length}건이 열려 있다`;
  if (isBlocked) console.log('\nqh pr: 아직 올릴 수 없다 (위 항목 해결 필요)');
  else require('../lib/measure').finishPr(root, a.config, open);
  return isBlocked ? EXIT.failed : EXIT.ok;
}

// Only after the person said yes: binds their confirmation to this exact version of the criteria.
function cmdConfirm(root) {
  const fp = waivers.criteriaFingerprint(root);
  if (waivers.isCriteriaRecorded(root)) {
    console.log(`이미 확인됨 (기준 확인: ${fp})`);
    return EXIT.ok;
  }
  const file = path.join(root, DECISIONS_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const line = `- ${new Date().toISOString().slice(0, 10)} · 기준 확인: ${fp} · 사용자가 품질 기준(설정·권한 표)을 확인함 · 설정이나 권한 표가 바뀌면`;
  fs.writeFileSync(file, `${prev}${prev && !prev.endsWith('\n') ? '\n' : ''}${line}\n`);
  console.log(`기록: ${DECISIONS_FILE}에 "${line}"`);
  return EXIT.ok;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// exit 0 + JSON on stdout: Claude Code documents this as Stop decision control, and
// a Kiro Stop hook used in practice relies on it (there a non-zero exit only warns the user; 추정).
// systemMessage: shown to the user, not to the agent (warnings are not the agent's to fix).
function block(reason, systemMessage) {
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason, ...(systemMessage ? { systemMessage } : {}) })}\n`);
  return EXIT.ok;
}

// What the person sees: only the plain sentences, each once.
const userLines = (items) => [...new Set(items.map((x) => `- ${x.user}`))].join('\n');
const warningNote = (t) => (t.warnings.length ? `품질 검사 경고 (막지 않음)\n${userLines(t.warnings)}` : null);
const askLines = (items) => items.map((x) => `- ${x.agent}\n  Tell the user: ${x.user}`).join('\n');
const plainFixes = (items, config) => items.map((x) => ({ user: aiFixUser(x, config) }));
const stuckNote = (items, config) => `품질 검사: AI가 아래 문제를 고치지 못하고 멈췄습니다. AI에게 "남은 품질 문제 고쳐줘"라고 하거나, 그대로 둘지 정해 주세요.\n${userLines(plainFixes(items, config))}`;

// Kiro sends no stop_hook_active, does not call Stop again after a block and shows no
// systemMessage (Kiro CLI 3.3.0, /tmp/qh-e2e/B): the agent rechecks itself and carries the words.
const oneShotTail = (lines) => `\n\nThis host does not call this check again after you fix things. After fixing, run \`qh status\` yourself and end only when nothing is left. If something remains, report what you could not fix to the user.\nWhat to tell the user (this host shows the person no separate notice; put what remains in your response in these words):\n${lines}`;

let stopHost;
function hookInput() {
  if (stopHost) return stopHost;
  const raw = readStdin() || '{}';
  const data = parseJson(raw);
  const input = data && typeof data === 'object' ? data : {};
  return stopHost = {
    raw: JSON.stringify(Object.fromEntries(['session_id', 'hook_event_name', 'stop_hook_active', 'cwd'].filter((k) => Object.hasOwn(input, k)).map((k) => [k, input[k]]))),
    session: typeof input.session_id === 'string' ? input.session_id : '',
    isOneShot: !('stop_hook_active' in input),
    lastMessage: typeof input.last_assistant_message === 'string' ? input.last_assistant_message : '',
  };
}

// The gate hands the agent only what is new, so it never loops on what the agent cannot fix.
// - An AI-fix item (by kind: "TDD", "검사 unit") blocks again only after the tree changed, and at
//   most limits.sameBlocks times in a row (default 2, rationale in docs/reference.md); another item coming or going does not reset it.
// - Questions for the person and environment errors are handed back once per distinct content.
// What is not handed back goes to the person as a systemMessage, once per distinct content.
// State is per agent session (lib/stop-state.js).

function hookStop(root) {
  fs.mkdirSync(path.join(root, EVIDENCE_DIR), { recursive: true });
  const host = hookInput();
  fs.writeFileSync(path.join(root, EVIDENCE_DIR, 'last-hook-input.json'), host.raw);
  try {
    return judgeStop(root, loadConfig(root), host);
  } catch (err) {
    // An environment error with words for the person (broken config, no common ancestor) is told once, not swallowed.
    if (!(err instanceof EnvError) || !err.user) throw err;
    const last = stopState.readSession(root, host.session);
    if (last.envNote === err.user) return EXIT.ok;
    stopState.writeSession(root, host.session, { ...last, envNote: err.user }, host.isOneShot ? `- ${err.user}` : undefined);
    return block(`qh: could not judge because of an environment error (환경 오류).\n환경 오류 (do not change code; report it to the user):\n${askLines([{ agent: err.message, user: err.user }])}`, err.user);
  }
}

function judgeStop(root, config, host) {
  if (!envProblems(root, config).length) cmdCheck(root, [], { builtinOnly: true });
  const a = assess(root);
  // The agent writes the card's open decisions itself, so a last answer that asks something has
  // asked them; turning it back makes the person read the same question twice. Agents ask in
  // Korean as often with "…주세요." as with "?" (sandbox run 2026-11-17). The PR gate still
  // blocks on any open decision, so a wrong guess here cannot let one through.
  // ponytail: "?"/"주세요" is the only signal, compare the decision text if that misfires.
  const isAsking = /[?？]|주세요/.test(host.lastMessage);
  const t = triage(isAsking ? { ...a, decisions: [] } : a);
  const humanPart = t.human.length ? `\nAsk the user (ask in your response and end it. The user may not be a developer: ask like the "Tell the user:" sentences below, with no file paths, commands, commit hashes, or tool names):\n${askLines(t.human)}` : '';
  const envPart = t.env.length ? `\n환경 오류 (do not change code; report it to the user):\n${askLines(t.env)}` : '';
  const askPart = `${humanPart}${envPart}`;

  const last = stopState.readSession(root, host.session);
  const counts = last.counts || {};
  const isGivenUp = (x) => Boolean(counts[aiFixKind(x)]) && (last.tree === a.treeHash || counts[aiFixKind(x)] >= LIMITS.sameBlocks);
  const fresh = t.aiFix.filter((x) => !isGivenUp(x));
  const givenUp = t.aiFix.filter(isGivenUp);
  const nextCounts = Object.fromEntries(t.aiFix.map(aiFixKind).map((k) => [k, fresh.some((x) => aiFixKind(x) === k) ? (counts[k] || 0) + 1 : counts[k]]));
  const forPerson = [...plainFixes(t.aiFix, a.config), ...t.human, ...t.env, ...t.warnings];
  const pending = host.isOneShot ? (forPerson.length ? userLines(forPerson) : null) : undefined;
  if (fresh.length || (askPart !== '' && askPart !== last.askPart)) {
    stopState.writeSession(root, host.session, { unexpectedErrors: last.unexpectedErrors, tree: a.treeHash, counts: nextCounts, askPart }, pending);
    // What this block shows the person counts as asked: the routes (waivers are answered on the task card).
    stopState.markAsked(root, a.undeclared);
    if (fresh.length) require('../lib/measure').logStop(root, { aiFix: fresh, human: t.human });
    const head = fresh.length ? `qh: fix these before ending\n${fresh.map((x) => `- ${x}`).join('\n')}` : t.env.length ? 'qh: could not judge because of an environment error (환경 오류).' : 'qh: checks passed.';
    return block(`${head}${askPart}${host.isOneShot ? oneShotTail(userLines(forPerson)) : ''}`, warningNote(t));
  }
  const note = [
    givenUp.length && stuckNote(givenUp, a.config),
    askPart && `사람이 판단할 일 (AI에게 이미 전함)\n${userLines([...t.human, ...t.env])}`,
    warningNote(t),
  ].filter(Boolean).join('\n');
  stopState.writeSession(root, host.session, { unexpectedErrors: last.unexpectedErrors, tree: last.tree, counts: nextCounts, askPart, notified: note }, pending);
  if (note && note !== last.notified) process.stdout.write(`${JSON.stringify({ systemMessage: note })}\n`);
  return EXIT.ok;
}

// Records what the app does today as the first access table. A person reads it once:
// entries with a "check" note are guesses, and today's bugs are in it too.
function cmdRoutesBaseline(root, args) {
  if (fs.existsSync(path.join(root, ACCESS_FILE))) {
    console.log(`${ACCESS_FILE}이 이미 있다. 사람이 정한 내용이 지워지니 덮어쓰지 않는다 (다시 만들려면 파일을 직접 옮긴 뒤 실행).`);
    return EXIT.failed;
  }
  const given = routesBaseline.parseOptions(args);
  if (given.error) {
    console.log(given.error);
    return EXIT.failed;
  }
  const { levels, labels } = given;
  const runner = path.join(QH_HOME, 'lib', 'run-builtin.js');
  const opts = JSON.stringify({ baseline: true, levels });
  const r = spawnSync(process.execPath, [runner, 'route-access', root, opts], { cwd: root, encoding: 'utf8', maxBuffer: MAX_BUFFER, timeout: DEFAULT_TIMEOUT_SEC * 1000 });
  const result = parseJson(r.stdout);
  if (!result?.baseline) throw new EnvError(`기준선을 만들지 못함: ${result?.envError || result?.error || (r.stderr || '').trim().split('\n')[0]}`);
  fs.writeFileSync(path.join(root, ACCESS_FILE), `${JSON.stringify({ levels: result.baseline.levels, labels, routes: result.baseline.routes }, null, 2)}\n`);
  console.log(routesBaseline.reportLines(ACCESS_FILE, result).join('\n'));
  return EXIT.ok;
}

// Records today's tool findings as "already there". Grown entries reach a person through configChanges.
function cmdBaseline(root) {
  const structure = loadConfig(root).structure;
  if (!repoTools.enabled(structure).length && !allowedFailures(root).length) {
    console.log(`config structure에 켜진 도구(${repoTools.KINDS.join('·')})가 없다. 기록할 것이 없다.`);
    return EXIT.failed;
  }
  try {
    const failures = baselineFailures(root);
    const counts = repoTools.writeBaseline(root, structure, failures);
    const recorded = [...Object.entries(counts).map(([k, n]) => `${k} ${n}건`), ...Object.entries(failures).map(([k, tests]) => `기존 실패 ${k} ${tests.length}건`)];
    console.log(recorded.length ? `${repoTools.BASELINE_FILE}: ${recorded.join(', ')}을 "기존"으로 기록. 커밋한다 (늘어난 항목은 PR에서 사람이 확인).` : `${repoTools.BASELINE_FILE}: 갱신할 항목 없음(기존 기준 유지).`);
    return EXIT.ok;
  } catch (err) {
    if (err instanceof repoTools.ToolError || err instanceof ToolMissing) throw new EnvError(err.message);
    throw err;
  }
}

function hookSessionStart(root) {
  const unasked = loadConfig(root)?.answers ? '' : '\n(qh) The project questions are not answered yet → tell the user, and if they want, open a question session as .quality/qh/lib/ask-guide.md says.';
  const pending = stopState.takePending(root);
  const left = pending ? `\n(qh) The last session ended with quality problems left (that host does not show notices). If the status above still has them, tell the user:\n${pending}` : '';
  const cycle = require('../lib/cycle').cycleLines(root, taskCard(root).text).map((l) => `\n(qh) ${l}`).join('');
  const words = require('../lib/me').wordsLine(root);
  console.log(`${formatStatus(assess(root))}${unasked}${words ? `\n(qh) ${words}` : ''}${cycle}${left}\n\n(qh) Before ending a response, run the needed checks with \`qh check\` to leave evidence. \`qh status\` shows their state.`);
  return EXIT.ok;
}

const USAGE = `사용: qh <명령>
  init [프로젝트 경로]   qh를 프로젝트 .quality/qh/에 설치하고 hook·규칙·설정 초안을 붙임
  check [이름…]        필요한 검사 실행 (이름을 주면 그것만)
  answer < 답          질문 화면에서 복사한 답을 검증해 config.answers와 결정 로그에 저장
  ask                  프로젝트 질문 화면(로컬 HTML)을 만들어 경로를 알려 줌
  cycle                카드가 어느 단계인지, 다음에 사람이 정할 것, 아키텍처 점검 시기를 한 줄로
  view interface <json> | view architecture <json> | view spec <md> [--wait [--timeout 초]] | view glossary  선택 화면·용어집을 로컬 HTML로 만들어 경로를 알려 줌
  measure [--backfill 주]  지금 상태를 재서 .quality/metrics.csv에 더하고 결과지를 .quality/reports/에 쌓음
  doctor               qh가 제대로 설치·설정됐는지 전체 점검
  review [--base ref]  변경을 AI로 리뷰 (보고만 함)
  pr                   PR 직전: 검사 전부 + 리뷰 + 판정
  status [--json] [--pr] [--base ref]  상태표 (--pr: PR 기준, --base: config.baseRef 대신 비교할 ref)
  routes --baseline --levels a,b,c [--labels 이름,이름,이름]  현재 동작으로 권한 표 첫 버전 만들기
  uninstall            qh가 init으로 더한 것(복사본·hook·규칙 블록·skill)을 걷어내고 사용자의 내용은 둠
  confirm              사용자가 지금 품질 기준(설정·권한 표)을 확인했다고 결정 로그에 기록 (바뀌면 다시 물음)
  baseline             구조 도구(미사용·순환 참조·유사 함수)의 지금 항목을 ${repoTools.BASELINE_FILE}에 기록
  spec-check --task | --result [파일]  명세 대조: 하위 AI 지시문을 쓰고, 그 결과를 확인해 기록
  hook session-start | hook stop`;

function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'init') return require('../lib/init').init(QH_HOME, rest[0] || process.cwd());
  const root = findRoot(process.cwd());
  loadLimits(root);
  if (cmd === 'uninstall') return require('../lib/uninstall').uninstall(QH_HOME, root);
  if (cmd === 'routes' && rest.includes('--baseline')) return cmdRoutesBaseline(root, rest);
  if (cmd === 'check') return cmdCheck(root, rest.filter((x) => x !== '--pr'), { phase: rest.includes('--pr') ? 'pr' : 'stop' });
  if (cmd === 'baseline') return cmdBaseline(root);
  if (cmd === 'spec-check') return require('../lib/spec-check').run(root, rest, taskCard(root));
  if (cmd === 'confirm') return cmdConfirm(root);
  if (cmd === 'doctor') {
    const problems = doctor(root);
    console.log(formatDoctor(problems));
    return problems.some((p) => p.level === '실패') ? EXIT.failed : EXIT.ok;
  }
  if (cmd === 'review') return runReview(root, loadConfig(root), rest.includes('--base') ? rest[rest.indexOf('--base') + 1] : undefined);
  if (cmd === 'pr') return cmdPr(root);
  if (cmd === 'answer') {
    const r = require('../lib/ask').answer(root, readStdin());
    if (r.errors.length) {
      console.log(['저장하지 않음:', ...r.errors.map((e) => `  - ${e}`)].join('\n'));
      return EXIT.failed;
    }
    const bg = r.background ? `배경: ${require('../lib/me').ME_FILE}에 저장 (이 컴퓨터에만, 저장소에 올리지 않음)` : '';
    console.log([r.log.length ? `저장: .quality/config.json answers, docs/decisions.md에 ${r.log.length}줄\n${r.log.join('\n')}` : bg ? '' : '바뀐 답 없음', bg].filter(Boolean).join('\n'));
    return EXIT.ok;
  }
  if (cmd === 'measure') {
    const at = rest.indexOf('--backfill');
    const weeks = at >= 0 ? Number(rest[at + 1]) : 0;
    if (at >= 0 && !(Number.isInteger(weeks) && weeks > 0)) {
      console.log('사용: qh measure [--backfill <주 수>]');
      return EXIT.failed;
    }
    if (!hasCommit(root)) throw new EnvError(NO_COMMIT);
    const r = require('../lib/measure').measure(root, { weeks });
    console.log(`측정: ${r.added}줄 추가 → ${METRICS_FILE}\n결과지: ${r.page}\n브라우저로 연다. 지난 결과지도 ${REPORTS_DIR}/에 날짜순으로 남는다.`);
    return EXIT.ok;
  }
  if (cmd === 'cycle') {
    console.log(require('../lib/cycle').cycleLines(root, taskCard(root).text, { always: true }).join('\n'));
    return EXIT.ok;
  }
  if (cmd === 'view') return require('../lib/view').run(root, rest, loadConfig(root));
  if (cmd === 'ask') {
    const file = require('../lib/ask').ask(root, loadConfig(root));
    console.log(`질문 화면: ${file}\n브라우저로 열어 고른 뒤 "프롬프트 복사" → 에이전트 창에 붙여 넣는다 (파일은 이 컴퓨터에만 있다).`);
    return EXIT.ok;
  }
  if (cmd === 'status') {
    const a = assess(root, rest.includes('--pr') ? 'pr' : 'stop', rest.includes('--base') ? rest[rest.indexOf('--base') + 1] : undefined);
    const { config, ...rest2 } = a;
    console.log(rest.includes('--json') ? JSON.stringify(rest2) : formatStatus(a));
    return rest.includes('--pr') && isPrBlocked(a, triage(a), doctor(root)) ? EXIT.failed : EXIT.ok;
  }
  if (cmd === 'hook' && rest[0] === 'stop') return hookStop(root);
  if (cmd === 'hook' && rest[0] === 'session-start') return hookSessionStart(root);
  console.log(USAGE);
  return cmd ? EXIT.failed : EXIT.ok;
}

Promise.resolve().then(() => main(process.argv.slice(2))).then((code) => {
  process.exitCode = code;
}).catch((err) => {
  const isHook = process.argv[2] === 'hook';
  if (err instanceof EnvError && !isHook) {
    console.log(`환경 오류 (코드를 고치지 말고 사용자에게 보고)\n  - ${err.message}`);
    process.exitCode = EXIT.env;
  } else if (err instanceof EnvError && isHook) {
    process.exitCode = EXIT.ok; // not a qh project here: stay out of the way
  } else if (isHook && process.argv[3] === 'stop') {
    try {
      const notice = stopState.unexpectedError(findRoot(process.cwd()), hookInput(), err.message);
      if (notice.reason) block(notice.reason, notice.systemMessage);
      else process.stdout.write(`${JSON.stringify(notice)}\n`);
    } catch (noticeErr) {
      process.stderr.write(`qh 오류 (판정하지 못함): ${err.message} / ${noticeErr.message}\n`);
    }
    process.exitCode = EXIT.ok;
  } else {
    process.stderr.write(`qh 오류 (판정하지 않고 넘어감): ${err.message}\n`);
    process.exitCode = isHook ? EXIT.ok : EXIT.failed;
  }
});
