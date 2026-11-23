'use strict';

// The status table `qh status`, the session start and `qh pr` print.

const { triage } = require('./triage');

function formatStatus(a) {
  const t = triage(a);
  const out = [`qh 상태 (트리 ${a.treeHash.slice(0, 7)}, 기준 ${a.baseRef})`];
  if (a.changed) out.push(`바뀐 파일 ${a.changed.length}개${a.risks.length ? ` · 위험: ${a.risks.map((r) => `${r.risk}(${r.files.join(', ')})`).join('; ')}` : ''}`);
  for (const c of a.checks) out.push(`  ${c.name.padEnd(10)} ${c.state}${c.detail?.length ? `\n    ${c.detail.join('\n    ')}` : ''}`);
  if (a.later.length) out.push(`  (PR 때 실행: ${a.later.join(', ')})`);
  out.push(`AI 리뷰: ${formatReview(a.review)}`);
  if (t.aiFix.length) out.push('AI가 고칠 일', ...t.aiFix.map((x) => `  - ${x}`));
  if (t.human.length) out.push('사람이 판단할 일', ...t.human.map((x) => `  - ${x.agent}`));
  if (t.env.length) out.push('환경 오류 (코드를 고치지 말고 사용자에게 보고)', ...t.env.map((x) => `  - ${x.agent}`));
  if (t.warnings.length) out.push('경고 (막지 않음)', ...t.warnings.map((x) => `  - ${x.agent}`));
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

module.exports = { formatStatus };
