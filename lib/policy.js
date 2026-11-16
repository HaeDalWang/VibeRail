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

// changed: files of this work; risks: matched risk areas; isCriteriaChanged: config or
// access table changed; card: the task card text ('' when none).
function policyProblems(root, { changed, risks, isCriteriaChanged, card, cardPath }) {
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
  if (risks.length && !changed.some((f) => path.matchesGlob(f, ADR_GLOB)) && !declared(card, 'ADR 불필요')) {
    out.push(`ADR: 위험 영역(${risks.map((r) => r.risk).join(', ')})이 바뀌었다 → ${ADR_GLOB.replace('*', 'NNNN-제목')}에 결정·이유·대안을 쓰거나, ${cardPath}에 \`ADR 불필요: 이유\``);
  }
  if (isCriteriaChanged && !changed.includes(DECISIONS_FILE)) {
    out.push(`결정 로그: 품질 기준(.quality/config.json·access.json)이 바뀌었다 → ${DECISIONS_FILE}에 한 줄(날짜 · 결정 · 이유 · 다시 볼 조건)`);
  }
  return [...out, ...secretProblems(root, changed)];
}

module.exports = { policyProblems, DECISIONS_FILE, CODE_EXT, TEST_FILE, OWN_FILES, MAX_SCAN_BYTES };
