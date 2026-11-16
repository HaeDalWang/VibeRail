'use strict';

// The always-on safety line (no question turns these off): every change says what it
// did to tests and docs, risky changes carry an ADR, changes to the gate's own criteria
// are logged, and no secret lands in the code. Cheap and evidence-free, so they run at
// every Stop and in the PR. Declarations ("테스트 불필요: 이유" …) live in the branch's
// task card, so they travel with the change and the PR reviewer reads them.

const fs = require('node:fs');
const path = require('node:path');

const DECISIONS_FILE = 'docs/decisions.md';
const ADR_GLOB = 'docs/adr/*.md';
const MIN_REASON_CHARS = 5;
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
const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[^/]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/;
const DOC_FILE = /\.(md|mdx|rst|txt)$/;
const OWN_FILES = /^(\.quality|\.claude|\.kiro)\/|^(AGENTS|CLAUDE)\.md$/;
const ENV_FILE = /(^|\/)\.env(\.[^/]*)?$/;
const ENV_TEMPLATE = /\.(example|sample|template)$/;

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

const declared = (card, label) => new RegExp(`^\\s*(-\\s*)?${label}:\\s*(.{${MIN_REASON_CHARS},})$`, 'm').test(card);

function secretProblems(root, changed) {
  const out = [];
  for (const f of changed) {
    if (f.startsWith('.quality/qh/')) continue;
    if (ENV_FILE.test(f) && !ENV_TEMPLATE.test(f)) out.push(`비밀값 파일: ${f}가 git에 올라갈 상태다 → .gitignore에 넣고 값은 환경변수로`);
    const file = path.join(root, f);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size > MAX_SCAN_BYTES) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes('\0')) continue;
    text.split('\n').forEach((line, i) => {
      if (line.includes(ALLOW_SECRET)) return;
      const hit = SECRETS.find(([, re]) => re.test(line));
      if (hit) out.push(`비밀값 의심: ${f}:${i + 1} (${hit[0]}) → 코드에서 빼고 환경변수로. 이미 커밋·푸시됐다면 사용자에게 키 교체를 알린다 (오탐이면 그 줄에 \`${ALLOW_SECRET}\` 주석)`);
    });
  }
  return out;
}

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
  return [`연동 실패 테스트: 외부 연동 코드가 바뀌었는데 상대가 실패할 때(시간 초과·5xx·거절)의 테스트가 이번 변경에 없다 → 그 테스트를 쓰거나, ${cardPath}에 \`연동 실패 테스트 불필요: 이유\``];
}

// Tests for `{tests}` in a check command: changed test files, plus tests named after a
// changed code file (src/auth.mjs → any …/auth.test.mjs, auth.spec.ts, test_auth.py).
// ponytail: name match only; a code file without a same-name test is covered at PR.
function relatedTests(root, changed, tracked) {
  const exists = (f) => fs.existsSync(path.join(root, f));
  const stem = (f) => path.basename(f).replace(/\.[^.]+$/, '');
  const tests = tracked.filter((f) => TEST_FILE.test(f) && CODE_EXT.test(f));
  const stems = new Set(changed.filter((f) => CODE_EXT.test(f) && !TEST_FILE.test(f) && !OWN_FILES.test(f)).map(stem));
  const named = tests.filter((t) => { const b = path.basename(t); return [...stems].some((s) => b.startsWith(`${s}.test.`) || b.startsWith(`${s}.spec.`) || b === `test_${s}.py` || b === `${s}_test.go` || b === `${s}_test.py`); });
  return [...new Set([...changed.filter((f) => TEST_FILE.test(f) && CODE_EXT.test(f)), ...named])].filter(exists).sort();
}

// changed: files of this work; risks: matched risk areas; isCriteriaChanged: config or
// access table changed; card: the task card text ('' when none); answers: effective
// project answers (null before the first question session).
function policyProblems(root, { changed, risks, isCriteriaChanged, card, cardPath, answers }) {
  const out = [];
  const code = changed.filter((f) => CODE_EXT.test(f) && !OWN_FILES.test(f));
  const prod = code.filter((f) => !TEST_FILE.test(f));
  const has = (re) => changed.some((f) => re.test(f) && !OWN_FILES.test(f));
  if (prod.length && !code.some((f) => TEST_FILE.test(f)) && !declared(card, '테스트 불필요')) {
    out.push(`TDD: 코드(${prod.slice(0, 3).join(', ')}${prod.length > 3 ? ' …' : ''})가 바뀌었는데 테스트 변경이 없다 → 실패하는 테스트를 먼저 쓰고 고친다. 정말 필요 없으면 ${cardPath}에 \`테스트 불필요: 이유\``);
  }
  if (prod.length && !has(DOC_FILE) && !declared(card, '문서 영향 없음')) {
    out.push(`문서 영향: 코드가 바뀌었는데 문서 변경이 없다 → 영향받는 문서를 같은 작업에서 고치거나, ${cardPath}에 \`문서 영향 없음: 이유\``);
  }
  // The person said this work really changes a risky behaviour: no "ADR 불필요" for it.
  const confirmed = Object.entries(require('./questions').taskAnswers(card)).filter(([r, v]) => v === 'A' && risks.some((x) => x.risk === r)).map(([r]) => r);
  const isAdrWaived = declared(card, 'ADR 불필요') && !confirmed.length;
  if (risks.length && !changed.some((f) => path.matchesGlob(f, ADR_GLOB)) && !isAdrWaived) {
    out.push(`ADR: 위험 영역(${risks.map((r) => r.risk).join(', ')})이 바뀌었다 → ${ADR_GLOB.replace('*', 'NNNN-제목')}에 결정·이유·대안을 쓴다${confirmed.length ? ` (작업 질문에서 ${confirmed.join(', ')} 변경 있음이라 ADR 불필요는 안 됨)` : `. 정말 필요 없으면 ${cardPath}에 \`ADR 불필요: 이유\``}`);
  }
  if (isCriteriaChanged && !changed.includes(DECISIONS_FILE)) {
    out.push(`결정 로그: 품질 기준(.quality/config.json·access.json)이 바뀌었다 → ${DECISIONS_FILE}에 한 줄(날짜 · 결정 · 이유 · 다시 볼 조건)`);
  }
  if (answers?.personal === 'A') out.push(...piiLogProblems(root, prod));
  if (answers?.external === 'A') out.push(...integrationFailureProblems(root, { changed, risks, card, cardPath }));
  return [...out, ...secretProblems(root, changed)];
}

module.exports = { policyProblems, relatedTests, DECISIONS_FILE, CODE_EXT, TEST_FILE, OWN_FILES, MAX_SCAN_BYTES };
