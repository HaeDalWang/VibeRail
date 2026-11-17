'use strict';

// The always-on safety line (no question turns these off): every change says what it
// did to tests and docs, risky changes carry an ADR, changes to the gate's own criteria
// are logged, and no secret lands in the code. Cheap and evidence-free, so they run at
// every Stop and in the PR. Declarations ("테스트 불필요: 이유" …) live in the branch's
// task card, so they travel with the change and the PR reviewer reads them.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SECTIONS, section, seamPaths, addedLines } = require('./card');

const DECISIONS_FILE = 'docs/decisions.md';
const ADR_GLOB = 'docs/adr/*.md';
// Defaults with no outside basis (docs/reference.md): a project changes them in config `limits`.
const DEFAULT_LIMITS = { reasonChars: 5, duplicateLines: 6, duplicateLineChars: 8, architectureCards: 3, architectureDays: 7, loopTickets: 3, stopSeconds: 10 };
const MIN_REASON_CHARS = DEFAULT_LIMITS.reasonChars;
// ponytail: one process-wide copy, set once per run by bin/qh.js; pass limits down if a run ever serves two projects.
const LIMITS = { ...DEFAULT_LIMITS };
// A value that is not a positive whole number keeps the default; a missing or broken config is loadConfig's to report.
function loadLimits(root) {
  let given = {};
  try {
    given = JSON.parse(fs.readFileSync(path.join(root, '.quality/config.json'), 'utf8')).limits || {};
  } catch {
    given = {};
  }
  for (const k of Object.keys(DEFAULT_LIMITS)) LIMITS[k] = Number.isInteger(given[k]) && given[k] > 0 ? given[k] : DEFAULT_LIMITS[k];
  return LIMITS;
}
const MAX_SCAN_BYTES = 1024 * 1024;
const ALLOW_SECRET = 'qh:allow-secret';
const ALLOW_PII = 'qh:allow-pii';
// A log call whose arguments name a personal field. Names, not values: values are not visible statically.
const LOG_CALL = /\b(console\.(log|info|warn|error|debug)|logger\.\w+|log\.(info|warn|error|debug)|print|logging\.\w+)\s*\(/;
const PII_NAME = /\b(e-?mail|phone|mobile|password|passwd|token|ssn|rrn|jumin|birth|address)\w*|주민|전화|휴대폰|비밀번호/i;
// ponytail: word match on the changed tests; read the test bodies per risk file if it lets weak tests through.
const FAILURE_WORDS = /timeout|reject|throw|toThrow|ECONN|\b5\d\d\b|fail/i;
// ponytail: fixed extension list, a config key when a project's code lives elsewhere.
const CODE_EXT = /\.(c|m)?[jt]sx?$|\.(py|go|rb|java|kt|rs|php|cs|swift|sql|sh|vue|svelte)$/;
const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|(^|\/)([^/]*\.)?Tests?\/|\.(test|spec|cy)\.[^/]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$|[a-z0-9]Tests?\.(swift|cs|java|kt|kts|scala|m|mm)$/;
const DOC_FILE = /\.(md|mdx|rst|txt)$/;
const OWN_FILES = /^(\.quality|\.claude|\.kiro)\/|^(AGENTS|CLAUDE)\.md$/;
// Files a tool wants at the package top: lock files, manifests and tool settings (by base name).
// Not code to test, not a stray root file. ponytail: fixed list, extend when a tool is missed.
const TOOL_FILE = /(^|\/)([^/]+\.config\.[cm]?[jt]s|[^/]+[.-]lock(file)?(\.json|\.ya?ml|b)?|npm-shrinkwrap\.json|package\.json|tsconfig[^/]*\.json|jsconfig\.json|pyproject\.toml|setup\.(py|cfg)|requirements[^/]*\.txt|Pipfile|go\.(mod|sum|work)|Cargo\.toml|Gemfile|composer\.json|deno\.jsonc?|pnpm-workspace\.yaml|Makefile|Dockerfile[^/]*|(docker-)?compose[^/]*\.ya?ml|Procfile)$/;
// The folder a file's package lives in: the nearest of these above it.
const PACKAGE_FILES = ['package.json', 'pyproject.toml', 'setup.py', 'go.mod', 'Cargo.toml', 'Gemfile', 'composer.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'deno.json'];
// A line git leaves when a merge stopped on a conflict.
const CONFLICT_MARK = /^(<{7}|>{7})( |$)/;
// Copied-in libraries are someone else's code: not measured, not compared for copies.
const VENDORED = /(^|\/)(vendor|third_party|node_modules)\//;
// Code this project writes: not qh's own files, not copied-in or minified code. One rule for every check.
const isOwnCode = (f) => CODE_EXT.test(f) && !OWN_FILES.test(f) && !VENDORED.test(f) && !/\.min\./.test(f);
const ENV_FILE = /(^|\/)\.env(\.[^/]*)?$/;
const ENV_TEMPLATE = /\.(example|sample|template)$/;
// A plain .env is the secret file by convention; a variant (.env.development) with only URLs and flags is config.
const SECRET_ASSIGN = /^\s*(export\s+)?\w*(KEY|TOKEN|SECRET|PASSWORD|PASS)\w*\s*=\s*\S/im;

// High-precision patterns only: a noisy scanner gets ignored. The secret itself is never printed.
const SECRETS = [
  ['AWS 액세스 키', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['개인 키', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['GitHub 토큰', /\b(gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})\b/],
  ['Slack 토큰', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['AI API 키', /\bsk-(ant-|proj-)?[A-Za-z0-9_-]{20,}/],
  ['Google API 키', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe 키', /\b[rs]k_live_[0-9A-Za-z]{20,}/],
  ['비밀번호가 든 접속 주소', /\b[a-z][a-z0-9+]*:\/\/[^\s:@/'"]+:[^\s@/'"]{3,}@(?!(localhost|127\.0\.0\.1|db|postgres|example)\b)/],
];

// The reason after "라벨:" in any common markdown shape (list, checkbox, quote, bold, backticks, full-width colon); null when absent.
function declaredReason(card, label) {
  for (const raw of card.split('\n')) {
    const line = raw.replace(/`|\*\*/g, '').replace(/^\s*(>\s*)*([-*+]\s+|\d+[.)]\s+)?(\[[ xX]\]\s*)?/, '');
    if (line.startsWith(label)) {
      const m = /^\s*[:：]\s*(.*?)\s*$/.exec(line.slice(label.length));
      if (m) return m[1];
    }
  }
  return null;
}
// A reason someone wrote: long enough, and not the hint's <placeholder> pasted as it is.
const isRealReason = (reason) => reason.length >= LIMITS.reasonChars && !/^<[^>]*>$/.test(reason);
// A decision-log line `<label>: <path> · <reason>` naming f, with a real reason after the path
// (the same rule as a task-card declaration: the hint's placeholder or "이유" does not count).
const isAllowedBy = (decisions, label, f) => decisions.split('\n').some((l) => {
  const at = l.indexOf(label);
  const rest = at === -1 ? '' : l.slice(at + label.length).replace(/`/g, '');
  const p = rest.indexOf(f);
  if (p === -1) return false;
  const after = rest.slice(p + f.length);
  return isRealReason((after.includes('·') ? after.split('·')[1] : after.replace(/^[\s:：,-]+/, '')).trim());
});
const declared = (card, label) => isRealReason(declaredReason(card, label) || '');
// What a hint shows in place of the reason, so a pasted hint is visibly unfinished.
const reasonSlot = (why) => `<${why}, ${LIMITS.reasonChars}자 이상>`;
const NO_NEED = reasonSlot('왜 필요 없는지');
// Said why, but too briefly: tell the agent instead of repeating the same block.
const shortHint = (card, label) => (declaredReason(card, label) !== null && !declared(card, label) ? ` (\`${label}\`의 이유는 ${LIMITS.reasonChars}자 이상, <…> 자리에 실제 이유)` : '');

function secretProblems(root, changed) {
  const out = [];
  for (const f of changed) {
    if (f.startsWith('.quality/qh/')) continue;
    const file = path.join(root, f);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size > MAX_SCAN_BYTES) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes('\0')) continue;
    // Out of git (taken out and ignored): it cannot be pushed, so neither the name nor the values count.
    if (ENV_FILE.test(f) && isIgnored(root, f)) continue;
    const isPlainEnv = /(^|\/)\.env$/.test(f);
    const isSecretEnv = ENV_FILE.test(f) && !ENV_TEMPLATE.test(f) && (isPlainEnv || SECRET_ASSIGN.test(text) || SECRETS.some(([, re]) => re.test(text)));
    if (isSecretEnv) out.push(`비밀값 파일: ${f}가 git에 올라갈 상태다 → .gitignore에 넣고 값은 환경변수로`);
    text.split('\n').forEach((line, i) => {
      const kind = secretKind(line);
      if (kind) out.push(`비밀값 의심: ${f}:${i + 1} (${kind}) → 코드에서 빼고 환경변수로. 이미 커밋·푸시됐다면 사용자에게 키 교체를 알린다 (오탐이면 그 줄에 \`${ALLOW_SECRET}\` 주석)`);
    });
  }
  return out;
}

// The kind of secret one line of file f holds, or null. An .env value named like a key counts too.
function secretKind(line, f = '') {
  if (line.includes(ALLOW_SECRET)) return null;
  const hit = SECRETS.find(([, re]) => re.test(line));
  if (hit) return hit[0];
  return ENV_FILE.test(f) && !ENV_TEMPLATE.test(f) && SECRET_ASSIGN.test(line) ? '.env 비밀값' : null;
}

// git says ignored only for a file it does not track: a tracked .env still counts.
const isIgnored = (root, f) => spawnSync('git', ['check-ignore', '-q', '--', f], { cwd: root }).status === 0;

const readSmall = (root, f) => {
  const file = path.join(root, f);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size > MAX_SCAN_BYTES) return null;
  const text = fs.readFileSync(file, 'utf8');
  return text.includes('\0') ? null : text;
};

// personal=A: a changed log line may not carry a personal field.
function piiLogProblems(root, prod) {
  const out = [];
  for (const f of prod) {
    (readSmall(root, f) || '').split('\n').forEach((line, i) => {
      const call = line.match(LOG_CALL);
      if (!call || line.includes(ALLOW_PII) || !PII_NAME.test(line.slice(call.index + call[0].length))) return;
      out.push(`개인정보 로그: ${f}:${i + 1} 로그에 개인정보 이름이 들어 있다 → 빼거나 가린다(예: 이메일 앞 2자만). 개인정보가 아니면 그 줄에 \`${ALLOW_PII}\` 주석`);
    });
  }
  return out;
}

// external=A: a change to integration code carries a test of the other side failing.
function integrationFailureProblems(root, { changed, risks, card, cardPath }) {
  if (!risks.some((r) => r.risk === 'external') || declared(card, '연동 실패 테스트 불필요')) return [];
  const tests = changed.filter((f) => TEST_FILE.test(f));
  if (tests.some((f) => FAILURE_WORDS.test(readSmall(root, f) || ''))) return [];
  return [`연동 실패 테스트: 외부 연동 코드가 바뀌었는데 상대가 실패할 때(시간 초과·5xx·거절)의 테스트가 이번 변경에 없다 → 그 테스트를 쓰거나, ${cardPath}에 \`연동 실패 테스트 불필요: ${NO_NEED}\``];
}

// Tests for `{tests}` in a check command: changed test files, plus tests named after a
// changed code file in the same language (src/auth.mjs → …/auth.test.ts, never test_auth.py).
// ponytail: name match only; a code file without a same-name test is covered at PR.
const LANG = [[/\.((c|m)?[jt]sx?|vue|svelte)$/, (s, b) => b.startsWith(`${s}.test.`) || b.startsWith(`${s}.spec.`)], [/\.py$/, (s, b) => b === `test_${s}.py` || b === `${s}_test.py`], [/\.go$/, (s, b) => b === `${s}_test.go`]];
const langOf = (f) => LANG.findIndex(([re]) => re.test(f));
function relatedTests(root, changed, tracked) {
  const exists = (f) => fs.existsSync(path.join(root, f));
  const stem = (f) => path.basename(f).replace(/\.[^.]+$/, '');
  const tests = tracked.filter((f) => TEST_FILE.test(f) && CODE_EXT.test(f));
  const codes = changed.filter((f) => CODE_EXT.test(f) && !TEST_FILE.test(f) && !OWN_FILES.test(f) && langOf(f) !== -1);
  const named = tests.filter((t) => codes.some((c) => langOf(t) === langOf(c) && LANG[langOf(c)][1](stem(c), path.basename(t))));
  return [...new Set([...changed.filter((f) => TEST_FILE.test(f) && CODE_EXT.test(f)), ...named])].filter(exists).sort();
}

// The nearest folder above f holding a package file; '' (the whole repository) when none does.
function packageOf(root, f, cache) {
  const dir = path.posix.dirname(f);
  if (dir === '.' || dir === '/') return '';
  if (!cache.has(dir)) cache.set(dir, PACKAGE_FILES.some((p) => fs.existsSync(path.join(root, dir, p))) ? dir : packageOf(root, dir, cache));
  return cache.get(dir);
}

// Code that this work changed (not deleted, not tool files) with no changed test in its package.
function untestedCode(root, code) {
  const cache = new Map();
  const tested = new Set(code.filter((f) => TEST_FILE.test(f)).map((f) => packageOf(root, f, cache)));
  return code.filter((f) => !TEST_FILE.test(f) && !TOOL_FILE.test(f) && fs.existsSync(path.join(root, f)) && !tested.has(packageOf(root, f, cache)));
}

// A test file counts for a seam when it is that file, sits under it, or is named for it (src/orders → orders.test.js).
const stemOf = (f) => path.basename(f).replace(/\.[^.]+$/, '').replace(/\.(test|spec|cy)$/, '').replace(/^test_|_test$/, '');
const isSeamTest = (t, s) => t === s || t.startsWith(`${s}/`) || stemOf(t) === path.basename(s).replace(/\.[^.]+$/, '');

// With seams in the card, the code this work changed when no changed test belongs to a seam.
function seamUntested(root, code, seams) {
  const prod = code.filter((f) => !TEST_FILE.test(f) && !TOOL_FILE.test(f) && fs.existsSync(path.join(root, f)));
  const tested = code.some((f) => TEST_FILE.test(f) && seams.some((s) => isSeamTest(f, s)));
  return tested ? [] : prod;
}

// qh-cycle: the person's intent is on the card, a picked interface and an architecture pick carry their reason.
// Only a card with a `## 의도` heading is held to it, so cards from before the cycle behave as they did.
function cycleProblems(root, { prod, card, cardPath, changed, base }) {
  const out = [];
  const intent = section(card, SECTIONS.intent);
  const written = (intent || '').split('\n').filter((l) => declaredReason(l, 'grilling 불필요') === null).join('').trim();
  if (prod.length && intent !== null && !written && !declared(card, 'grilling 불필요')) {
    out.push(`의도: 코드가 바뀌었는데 ${cardPath}의 \`## 의도\`가 비어 있다 → grilling skill로 사용자와 하려는 일과 범위를 정해 \`## 의도\`에 적는다. 재현되는 버그·오타처럼 작으면 \`grilling 불필요: ${reasonSlot('왜 안 물어도 되는지')}\`${shortHint(card, 'grilling 불필요')}`);
  }
  const chosen = section(card, SECTIONS.interface);
  if (chosen && !isRealReason(declaredReason(chosen, '이유') || '')) {
    out.push(`interface 결정: ${cardPath}의 \`## interface 결정\`에 고른 안이 있는데 이유가 없다 → 사용자에게 고른 이유를 묻고 \`이유: ${reasonSlot('사용자가 고른 이유')}\`로 적는다(에이전트가 대신 쓰지 않는다)`);
  }
  if (base && changed.includes(DECISIONS_FILE)) {
    const bad = addedLines(root, base, DECISIONS_FILE).filter((l) => l.includes('아키텍처 점검:')).filter((l) => !isRealReason(l.slice(l.indexOf('아키텍처 점검:') + 8).split(' · ').slice(2).join(' · ').trim()));
    if (bad.length) out.push(`아키텍처 점검: ${DECISIONS_FILE}의 \`아키텍처 점검:\` 줄에 고른 이유가 없다 → \`아키텍처 점검: <날짜> · <후보> · ${reasonSlot('사용자가 고른 이유')}\``);
  }
  return out;
}

// Lines git left from a merge that stopped on a conflict.
function conflictProblems(root, changed) {
  return changed.filter((f) => !f.startsWith('.quality/qh/')).flatMap((f) => {
    const i = (readSmall(root, f) || '').split('\n').findIndex((l) => CONFLICT_MARK.test(l));
    return i === -1 ? [] : [`충돌 표시: ${f}:${i + 1} 병합 충돌 표시(<<<<<<< · >>>>>>>)가 남아 있다 → 두 쪽 내용을 합치고 표시 줄을 지운다`];
  });
}

// changed: files of this work; risks: matched risk areas; isCriteriaChanged: config or
// access table changed; card: the task card text ('' when none); answers: effective
// project answers (null before the first question session).
function policyProblems(root, { changed, risks, isCriteriaChanged, card, cardPath, answers, base }) {
  const out = [];
  const code = changed.filter(isOwnCode);
  const prod = code.filter((f) => !TEST_FILE.test(f) && !TOOL_FILE.test(f));
  const has = (re) => changed.some((f) => re.test(f) && !OWN_FILES.test(f));
  const seams = seamPaths(card);
  const untested = seams.length ? seamUntested(root, code, seams) : untestedCode(root, code);
  if (untested.length && !declared(card, '테스트 불필요')) {
    const where = seams.length ? `카드의 테스트 위치(seam: ${seams.join(', ')})에 ` : code.some((f) => TEST_FILE.test(f)) ? '같은 패키지(가장 가까운 package.json·go.mod 등의 폴더)의 ' : '';
    out.push(`TDD: 코드(${untested.slice(0, 3).join(', ')}${untested.length > 3 ? ' …' : ''})가 바뀌었는데 ${where}테스트 변경이 없다 → 실패하는 테스트를 먼저 쓰고 고친다${seams.length ? ' (seam이 틀렸으면 사용자와 다시 정해 카드에 적는다)' : ''}. 정말 필요 없으면 ${cardPath}에 \`테스트 불필요: ${NO_NEED}\`${shortHint(card, '테스트 불필요')}`);
  }
  out.push(...cycleProblems(root, { prod, card, cardPath, changed, base }));
  if (prod.length && !has(DOC_FILE) && !declared(card, '문서 영향 없음')) {
    out.push(`문서 영향: 코드가 바뀌었는데 문서 변경이 없다 → 영향받는 문서를 같은 작업에서 고치거나, ${cardPath}에 \`문서 영향 없음: ${reasonSlot('왜 문서를 안 고쳐도 되는지')}\`${shortHint(card, '문서 영향 없음')}`);
  }
  // The person said this work really changes a risky behaviour: no "ADR 불필요" for it.
  const confirmed = Object.entries(require('./questions').taskAnswers(card)).filter(([r, v]) => v === 'A' && risks.some((x) => x.risk === r)).map(([r]) => r);
  const isAdrWaived = declared(card, 'ADR 불필요') && !confirmed.length;
  if (risks.length && !changed.some((f) => path.matchesGlob(f, ADR_GLOB)) && !isAdrWaived) {
    out.push(`ADR: 위험 영역(${risks.map((r) => r.risk).join(', ')})이 바뀌었다 → ${ADR_GLOB.replace('*', 'NNNN-제목')}에 결정·이유·대안을 쓴다${confirmed.length ? ` (작업 질문에서 ${confirmed.join(', ')} 변경 있음이라 ADR 불필요는 안 됨)` : `. 정말 필요 없으면 ${cardPath}에 \`ADR 불필요: ${NO_NEED}\`${shortHint(card, 'ADR 불필요')}`}`);
  }
  if (isCriteriaChanged && !changed.includes(DECISIONS_FILE)) {
    out.push(`결정 로그: 품질 기준(.quality/config.json·access.json)이 바뀌었다 → ${DECISIONS_FILE}에 한 줄(날짜 · 결정 · 이유 · 다시 볼 조건)`);
  }
  if (answers?.personal === 'A') out.push(...piiLogProblems(root, prod));
  if (answers?.external === 'A') out.push(...integrationFailureProblems(root, { changed, risks, card, cardPath }));
  return [...out, ...conflictProblems(root, changed), ...secretProblems(root, changed)];
}

module.exports = { policyProblems, isOwnCode, isAllowedBy, declared, declaredReason, MIN_REASON_CHARS, DEFAULT_LIMITS, LIMITS, loadLimits, relatedTests, secretKind, isRealReason, reasonSlot, DECISIONS_FILE, CODE_EXT, TEST_FILE, TOOL_FILE, OWN_FILES, MAX_SCAN_BYTES, VENDORED };
