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

const QH_HOME = path.join(__dirname, '..');
const EVIDENCE_DIR = '.quality/evidence';
const CONFIG_FILE = '.quality/config.json';
const ACCESS_FILE = '.quality/access.json';
const PHASES = ['stop', 'pr'];
const MAX_LISTED_CHANGES = 10;
const BASELINE_EXAMPLES = 3;
const DEFAULT_TIMEOUT_SEC = 300;
const DEFAULT_REVIEW_TIMEOUT_SEC = 900;
const MAX_BUFFER = 64 * 1024 * 1024;
const EXIT = { ok: 0, failed: 1, env: 3 };

class EnvError extends Error {}

// ---------- git ----------

function git(root, args, env) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: env || process.env, maxBuffer: MAX_BUFFER });
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
function treeHash(root) {
  const index = path.join(os.tmpdir(), `qh-index-${process.pid}-${Date.now()}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    git(root, ['add', '-A'], env);
    git(root, ['rm', '-r', '--cached', '-q', '--ignore-unmatch', '--', EVIDENCE_DIR], env);
    return git(root, ['write-tree'], env);
  } finally {
    fs.rmSync(index, { force: true });
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
  return [...files].filter((f) => !f.startsWith(`${EVIDENCE_DIR}/`)).sort();
}

// ---------- config & evidence ----------

function loadConfig(root) {
  const file = path.join(root, CONFIG_FILE);
  if (!fs.existsSync(file)) throw new EnvError(`${CONFIG_FILE} 없음`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function evidencePath(root, name) {
  return path.join(root, EVIDENCE_DIR, `${name}.json`);
}

function readEvidence(root, name) {
  const file = evidencePath(root, name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function writeEvidence(root, name, data) {
  fs.mkdirSync(path.join(root, EVIDENCE_DIR), { recursive: true });
  fs.writeFileSync(evidencePath(root, name), `${JSON.stringify(data, null, 2)}\n`);
}

// ---------- environment & requirements ----------

function envProblems(root, config) {
  const problems = doctor(root, { light: true }).map((p) => `설정: ${p.msg} → ${p.fix}`);
  if (problems.length) return problems;
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

function requirements(config, changed, phase) {
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
  const now = all.filter((n) => !config.checks?.[n] || runsIn(config.checks[n], phase));
  return { names: now, later: all.filter((n) => !now.includes(n)), risks, docsMissing };
}

// ---------- running checks ----------

function toolExists(root, cmd) {
  const tool = cmd.trim().split(/\s+/)[0];
  const r = spawnSync('sh', ['-c', 'command -v "$1" >/dev/null', '_', tool], { cwd: root });
  return r.status === 0 ? null : tool;
}

function spawnCheck(root, def, timeoutSec) {
  const opts = { cwd: root, encoding: 'utf8', timeout: timeoutSec * 1000, maxBuffer: MAX_BUFFER };
  if (def.builtin) {
    const runner = path.join(QH_HOME, 'lib', 'run-builtin.js');
    return spawnSync(process.execPath, [runner, def.builtin, root, JSON.stringify(def)], opts);
  }
  return spawnSync('sh', ['-c', def.cmd], opts);
}

function runCheck(root, name, def) {
  if (!def) throw new EnvError(`config에 없는 검사: ${name}`);
  const hash = treeHash(root);
  const base = { check: name, cmd: def.cmd || `builtin:${def.builtin}`, treeHash: hash, startedAt: new Date().toISOString() };
  const missing = def.builtin ? null : toolExists(root, def.cmd);
  if (missing) return writeEvidence(root, name, { ...base, envError: `도구 없음: ${missing}` });

  const r = spawnCheck(root, def, def.timeoutSec || DEFAULT_TIMEOUT_SEC);
  const logPath = path.join(EVIDENCE_DIR, `${name}.log`);
  fs.mkdirSync(path.join(root, EVIDENCE_DIR), { recursive: true });
  fs.writeFileSync(path.join(root, logPath), `${r.stdout || ''}${r.stderr || ''}`);
  const timedOut = r.error?.code === 'ETIMEDOUT';
  const evidence = { ...base, exit: timedOut ? 124 : (r.status ?? 1), timedOut, finishedAt: new Date().toISOString(), logPath };
  if (def.builtin) evidence.result = parseJson(r.stdout);
  if (evidence.result?.envError) evidence.envError = evidence.result.envError;
  writeEvidence(root, name, evidence);
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
  if (ev.envError) return { name, state: '환경 오류', detail: [ev.envError] };
  const isCurrent = ev.treeHash === now;
  const detail = describeResult(ev);
  if (ev.exit !== 0) return { name, state: '실패', isCurrent, detail, logPath: ev.logPath };
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

function taskDecisions(root) {
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const file = path.join(root, '.quality', 'tasks', `${branch}.md`);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const section = text.split(/^## /m).find((s) => s.startsWith('판단 필요'));
  if (!section) return [];
  return [...section.matchAll(/^- \[ \] (.+)$/gm)].map((m) => m[1].trim());
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

// What the gate measures against (checks, risks, the access table) changed in this work.
function configChanges(root, base, config) {
  const diffHint = `\`git diff ${base.slice(0, 7)} -- ${CONFIG_FILE} ${ACCESS_FILE}\`로 확인`;
  if (!git(root, ['ls-tree', '--name-only', base, CONFIG_FILE])) return [`qh 첫 설치: 기준(${base.slice(0, 7)})에 ${CONFIG_FILE}이 없다. 설정·권한 표 전체를 한 번 본다 → ${diffHint}`];
  const a = flatten({ ...readJsonAt(root, base, CONFIG_FILE), access: readJsonAt(root, base, ACCESS_FILE) });
  const b = flatten({ ...config, access: readJsonAt(root, null, ACCESS_FILE) });
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
  if (keys.length > MAX_LISTED_CHANGES) {
    // A first baseline adds hundreds of routes: one line per section, read it in the diff.
    const sections = Map.groupBy(keys, (k) => k.split('.').slice(0, 2).join('.'));
    return [...sections].map(([section, ks]) => `${section}: ${ks.length}개 항목 바뀜 → ${diffHint}`);
  }
  return keys.map((k) => `${k}: ${a[k] ?? '(없음)'} → ${b[k] ?? '(삭제)'}`);
}

function reviewStatus(root, now) {
  const ev = readEvidence(root, 'review');
  if (!ev) return { state: '미실행' };
  if (ev.envError) return { state: '환경 오류', detail: [ev.envError] };
  return { state: ev.treeHash === now ? '완료' : '이전 상태에서 완료', findings: ev.findings };
}

function assess(root, phase = 'stop') {
  const config = loadConfig(root);
  const env = envProblems(root, config);
  const now = treeHash(root);
  const out = { treeHash: now, baseRef: config.baseRef, phase, env, checks: [], later: [], risks: [], docsMissing: [], decisions: [], undeclared: [], configChanges: [], review: { state: '미실행' } };
  if (env.length) return { config, ...out };
  const base = git(root, ['merge-base', config.baseRef, 'HEAD']);
  const changed = changedFiles(root, base);
  const req = requirements(config, changed, phase);
  const checks = req.names.map((n) => (config.checks?.[n] ? checkStatus(root, n, now) : { name: n, state: '실패', detail: ['config.checks에 정의가 없다'] }));
  const undeclared = [...new Set(checks.filter((c) => c.isCurrent && c.result?.undeclared).flatMap((c) => c.result.undeclared))];
  return {
    config,
    ...out,
    base,
    changed,
    checks,
    later: req.later,
    risks: req.risks,
    docsMissing: req.docsMissing,
    decisions: taskDecisions(root),
    undeclared,
    configChanges: configChanges(root, base, config),
    review: reviewStatus(root, now),
  };
}

// Sorts what is left into who must act: the agent, a person, or nobody (environment).
function triage(a) {
  const aiFix = [];
  for (const c of a.checks) {
    if (c.state === '미실행') aiFix.push(`검사 ${c.name}: 미실행 → \`qh check ${c.name}\` 실행`);
    if (c.state === '실패') aiFix.push(`검사 ${c.name}: 실패${c.isCurrent === false ? '(이전 상태)' : ''} → 고친 뒤 \`qh check ${c.name}\`\n    ${(c.detail || []).join('\n    ')}`);
    if (c.state === '이전 상태에서 통과') aiFix.push(`검사 ${c.name}: 이전 상태에서 통과 → 그 뒤 코드가 바뀌었으니 \`qh check ${c.name}\` 재실행`);
  }
  for (const d of a.docsMissing) aiFix.push(`문서 미갱신: ${d.doc} (위험 ${d.risk}의 연동 문서) → 같은 작업에서 갱신`);
  const human = [
    ...a.undeclared.map((r) => `${r}: 접근 수준 미선언 → 누가 접근할 수 있는지 사용자에게 묻고, 답을 받은 뒤 ${ACCESS_FILE}의 routes에 적기`),
    ...a.decisions.map((d) => `작업 카드: ${d}`),
    ...a.configChanges.map((c) => `기준 변경(사람 확인 필요): ${c}`),
  ];
  const env = [...a.env, ...a.checks.filter((c) => c.state === '환경 오류').map((c) => `검사 ${c.name}: ${c.detail.join(' ')}`)];
  return { aiFix, human, env };
}

// ---------- output ----------

function formatStatus(a) {
  const t = triage(a);
  const out = [`qh 상태 (트리 ${a.treeHash.slice(0, 7)}, 기준 ${a.baseRef})`];
  if (a.changed) out.push(`바뀐 파일 ${a.changed.length}개${a.risks.length ? ` · 위험: ${a.risks.map((r) => `${r.risk}(${r.files.join(', ')})`).join('; ')}` : ''}`);
  for (const c of a.checks) out.push(`  ${c.name.padEnd(10)} ${c.state}${c.detail?.length ? `\n    ${c.detail.join('\n    ')}` : ''}`);
  if (a.later.length) out.push(`  (PR 때 실행: ${a.later.join(', ')})`);
  out.push(`AI 리뷰: ${formatReview(a.review)}`);
  if (t.aiFix.length) out.push('AI가 고칠 일', ...t.aiFix.map((x) => `  - ${x}`));
  if (t.human.length) out.push('사람이 판단할 일', ...t.human.map((x) => `  - ${x}`));
  if (t.env.length) out.push('환경 오류 (코드를 고치지 말고 사용자에게 보고)', ...t.env.map((x) => `  - ${x}`));
  return out.join('\n');
}

function formatReview(r) {
  if (!r.findings) return r.state + (r.detail ? ` — ${r.detail.join(' ')}` : '');
  const high = r.findings.filter((f) => f.severity === '높음').length;
  const list = [...r.findings]
    .sort((x, y) => (x.severity === '높음' ? -1 : 0) - (y.severity === '높음' ? -1 : 0))
    .map((f) => `\n    [${f.severity}/${f.verdict}] ${f.file}:${f.line} ${f.reason} → ${f.nextAction}`);
  return `${r.state} (지목 ${r.findings.length}건, 높음 ${high})${list.join('')}`;
}

// ---------- review ----------

function runReview(root, config, baseArg) {
  if (!config.review?.cmd) throw new EnvError('config.review.cmd 없음');
  const base = git(root, ['merge-base', baseArg || config.baseRef, 'HEAD']);
  const hash = treeHash(root);
  const outDir = path.join(root, EVIDENCE_DIR, 'review');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const messages = git(root, ['log', '--format=%s%n%b', `${base}..HEAD`]);
  const diffFile = path.join(outDir, 'change.diff');
  fs.writeFileSync(diffFile, `${messages}\n\n${git(root, ['diff', base, hash])}\n`);
  const taskFile = path.join(outDir, 'task.md');
  const fill = (s) => s.replaceAll('{{ROOT}}', root).replaceAll('{{DIFF}}', diffFile).replaceAll('{{OUT}}', outDir).replaceAll('{{BASE}}', base);
  fs.writeFileSync(taskFile, fill(fs.readFileSync(path.join(QH_HOME, 'lib', 'review-task.md'), 'utf8')));

  const cmd = config.review.cmd.replaceAll('{workdir}', root).replaceAll('{task}', taskFile).replaceAll('{out}', outDir);
  const evidence = { check: 'review', cmd, treeHash: hash, base, startedAt: new Date().toISOString() };
  const missing = toolExists(root, cmd);
  if (missing) return writeEvidence(root, 'review', { ...evidence, envError: `도구 없음: ${missing}` }) || EXIT.env;
  const started = Date.now();
  const r = spawnSync('sh', ['-c', cmd], { cwd: root, encoding: 'utf8', timeout: (config.review.timeoutSec || DEFAULT_REVIEW_TIMEOUT_SEC) * 1000, maxBuffer: MAX_BUFFER });
  fs.writeFileSync(path.join(outDir, 'run.log'), `${r.stdout || ''}${r.stderr || ''}`);
  const findings = readFindings(path.join(outDir, 'result.json'));
  const done = { ...evidence, exit: r.status ?? 124, elapsedSec: Math.round((Date.now() - started) / 1000), logPath: path.join(EVIDENCE_DIR, 'review', 'run.log') };
  if (!findings) {
    writeEvidence(root, 'review', { ...done, envError: `리뷰 결과(result.json)가 없거나 형식이 틀림 (exit ${done.exit}, 로그 ${done.logPath})` });
    return EXIT.env;
  }
  writeEvidence(root, 'review', { ...done, findings });
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
  if (builtinOnly) targets = targets.filter((n) => config.checks?.[n]?.builtin);
  for (const n of targets) runCheck(root, n, config.checks?.[n]);
  const after = assess(root, phase);
  if (!builtinOnly) console.log(formatStatus(after));
  const isFailing = after.checks.some((c) => targets.includes(c.name) && c.state !== '통과');
  return isFailing ? EXIT.failed : EXIT.ok;
}

function cmdPr(root) {
  const checkExit = cmdCheck(root, [], { phase: 'pr' });
  if (checkExit === EXIT.env) return EXIT.env;
  const reviewExit = runReview(root, loadConfig(root));
  const a = assess(root, 'pr');
  const t = triage(a);
  const setup = doctor(root);
  console.log(`\n${formatStatus(a)}\n${formatDoctor(setup)}`);
  const isBlocked = t.aiFix.length || a.undeclared.length || a.decisions.length || t.env.length || reviewExit !== EXIT.ok || setup.some((p) => p.level === '실패');
  console.log(isBlocked ? '\nqh pr: 아직 올릴 수 없다 (위 항목 해결 필요)' : '\nqh pr: 통과 (AI 리뷰 지목과 기준 변경은 PR 리뷰어가 확인)');
  return isBlocked ? EXIT.failed : EXIT.ok;
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
function block(reason) {
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason })}\n`);
  return EXIT.ok;
}

// AI-fix items block every time (the harness caps repeats). Human and environment
// items turn the agent back only once (stop_hook_active false) so it can ask or report.
function hookStop(root) {
  const raw = readStdin();
  const input = parseJson(raw) || {};
  fs.mkdirSync(path.join(root, EVIDENCE_DIR), { recursive: true });
  fs.writeFileSync(path.join(root, EVIDENCE_DIR, 'last-hook-input.json'), raw || '{}');
  const isRepeat = input.stop_hook_active === true;
  const config = loadConfig(root);
  if (!envProblems(root, config).length) cmdCheck(root, [], { builtinOnly: true });
  const t = triage(assess(root));
  const humanPart = t.human.length ? `\n사용자에게 물어볼 것 (응답에서 질문하고 끝내라):\n${t.human.map((x) => `- ${x}`).join('\n')}` : '';
  const envPart = t.env.length ? `\n환경 오류 (코드를 바꾸지 말고 사용자에게 보고하라):\n${t.env.map((x) => `- ${x}`).join('\n')}` : '';
  if (t.aiFix.length) return block(`qh: 끝내기 전에 고칠 일\n${t.aiFix.map((x) => `- ${x}`).join('\n')}${humanPart}${envPart}`);
  if ((humanPart || envPart) && !isRepeat) return block(`qh: 검사는 통과.${humanPart}${envPart}`);
  return EXIT.ok;
}

// Records what the app does today as the first access table. A person reads it once:
// entries with a "check" note are guesses, and today's bugs are in it too.
function cmdRoutesBaseline(root, args) {
  if (fs.existsSync(path.join(root, ACCESS_FILE))) {
    console.log(`${ACCESS_FILE}이 이미 있다. 사람이 정한 내용이 지워지니 덮어쓰지 않는다 (다시 만들려면 파일을 직접 옮긴 뒤 실행).`);
    return EXIT.failed;
  }
  const levelsArg = args.includes('--levels') ? args[args.indexOf('--levels') + 1] : null;
  if (!levelsArg) {
    console.log('사용: qh routes --baseline --levels public,member,admin  (낮은 수준부터, 첫 수준은 비로그인)');
    return EXIT.failed;
  }
  const runner = path.join(QH_HOME, 'lib', 'run-builtin.js');
  const opts = JSON.stringify({ baseline: true, levels: levelsArg.split(',') });
  const r = spawnSync(process.execPath, [runner, 'route-access', root, opts], { cwd: root, encoding: 'utf8', maxBuffer: MAX_BUFFER, timeout: DEFAULT_TIMEOUT_SEC * 1000 });
  const result = parseJson(r.stdout);
  if (!result?.baseline) throw new EnvError(`기준선을 만들지 못함: ${result?.envError || result?.error || (r.stderr || '').trim().split('\n')[0]}`);
  fs.writeFileSync(path.join(root, ACCESS_FILE), `${JSON.stringify(result.baseline, null, 2)}\n`);
  const total = Object.keys(result.baseline.routes).length;
  console.log(`${ACCESS_FILE}: 라우트 ${total}개를 현재 동작으로 기록. 사람이 확인할 추정 ${result.uncertain.length}개("check" 표시):`);
  const byReason = Map.groupBy(result.uncertain, (route) => result.baseline.routes[route].check);
  for (const [reason, routes] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
    const more = routes.length > BASELINE_EXAMPLES ? ` 외 ${routes.length - BASELINE_EXAMPLES}개` : '';
    console.log(`  - ${reason}: ${routes.length}개 (${routes.slice(0, BASELINE_EXAMPLES).join(', ')}${more})`);
  }
  console.log('"X에서 4xx/5xx"는 X가 거부되지 않았다는 뜻일 뿐, 그 뒤 역할 검사가 있는지는 모른다. 해당 라우트를 보고 수준을 고치고 check를 지운다.');
  console.log('현재 동작이라 기존 버그도 들어 있다. 커밋 전에 사람이 한 번 훑는다.');
  return EXIT.ok;
}

function hookSessionStart(root) {
  console.log(`${formatStatus(assess(root))}\n\n(qh) 응답을 끝내기 전에 필요한 검사를 \`qh check\`로 실행해 증거를 남긴다. 검사 상태는 \`qh status\`.`);
  return EXIT.ok;
}

const USAGE = `사용: qh <명령>
  init [프로젝트 경로]   qh를 프로젝트 .quality/qh/에 설치하고 hook·규칙·설정 초안을 붙임
  check [이름…]        필요한 검사 실행 (이름을 주면 그것만)
  doctor               qh가 제대로 설치·설정됐는지 전체 점검
  review [--base ref]  변경을 AI로 리뷰 (보고만 함)
  pr                   PR 직전: 검사 전부 + 리뷰 + 판정
  status [--json] [--pr]  상태표 (--pr: PR 기준)
  routes --baseline --levels a,b,c  현재 동작으로 권한 표 첫 버전 만들기
  hook session-start | hook stop`;

function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'init') return require('../lib/init').init(QH_HOME, rest[0] || process.cwd());
  const root = findRoot(process.cwd());
  if (cmd === 'routes' && rest.includes('--baseline')) return cmdRoutesBaseline(root, rest);
  if (cmd === 'check') return cmdCheck(root, rest);
  if (cmd === 'doctor') {
    const problems = doctor(root);
    console.log(formatDoctor(problems));
    return problems.some((p) => p.level === '실패') ? EXIT.failed : EXIT.ok;
  }
  if (cmd === 'review') return runReview(root, loadConfig(root), rest.includes('--base') ? rest[rest.indexOf('--base') + 1] : undefined);
  if (cmd === 'pr') return cmdPr(root);
  if (cmd === 'status') {
    const a = assess(root, rest.includes('--pr') ? 'pr' : 'stop');
    const { config, ...rest2 } = a;
    console.log(rest.includes('--json') ? JSON.stringify(rest2) : formatStatus(a));
    return EXIT.ok;
  }
  if (cmd === 'hook' && rest[0] === 'stop') return hookStop(root);
  if (cmd === 'hook' && rest[0] === 'session-start') return hookSessionStart(root);
  console.log(USAGE);
  return cmd ? EXIT.failed : EXIT.ok;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  const isHook = process.argv[2] === 'hook';
  if (err instanceof EnvError && !isHook) {
    console.log(`환경 오류 (코드를 고치지 말고 사용자에게 보고)\n  - ${err.message}`);
    process.exitCode = EXIT.env;
  } else if (err instanceof EnvError && isHook) {
    process.exitCode = EXIT.ok; // not a qh project here: stay out of the way
  } else {
    process.stderr.write(`qh 오류 (판정하지 않고 넘어감): ${err.message}\n`);
    process.exitCode = EXIT.failed;
  }
}
