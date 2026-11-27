'use strict';

// The review page qh review writes for ◆③: the existing records laid out in reading order
// (무엇이 바뀜 → 고른 안 → 테스트 증거 → 리뷰 지적 → 남은 판단). Nothing here is written by an AI;
// every item is copied from a record and names its source.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { esc } = require('./ask');
const { section, pick, items, lines, decisions, SECTIONS } = require('./card');
const { shell, write, optionRows, DRAW, MERMAID_FILE } = require('./view');
const { optionNumber, pickedOption, pendingConfirms } = require('./confirm');
const { declaredWaivers } = require('./waivers');

const NONE = '<p class="mute">기록 없음</p>';
const src = (s) => `<p class="mute">출처: ${esc(s)}</p>`;
const list = (items) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : NONE);
const step = (title, body) => `<article><h2>${title}</h2>${body}</article>`;

function subjects(root, base) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', 'log', '--format=%s', `${base}..HEAD`], { cwd: root, encoding: 'utf8' });
  return (r.stdout || '').split('\n').filter(Boolean);
}

function changedStep(root, { base, card, changed }) {
  const intent = section(card, SECTIONS.intent);
  return step('무엇이 바뀜', `<h3>하려는 일</h3>${intent ? `<pre>${esc(intent)}</pre>` : NONE}${src('작업 카드 ## 의도')}
<h3>커밋</h3>${list(subjects(root, base))}${src(`커밋 메시지 (${base.slice(0, 7)} 이후)`)}
<h3>바뀐 파일</h3>${list(changed)}${src('git diff')}`);
}

// The pick's confirmation number: unchanged, or the re-ask with the changed fields (lib/confirm.js).
function confirmPart(p, asked) {
  if (asked) {
    const fields = asked.changes?.fields?.map((f) => `${f.label}: ${f.old} → ${f.now}`) || [];
    return `<p class="msg warn">${esc(asked.user)}</p>${fields.length ? list(fields) : ''}${src('설계안 파일의 git 기록')}`;
  }
  return `<p>확인 번호 ${optionNumber(p.option)}: 고른 뒤 바뀌지 않았다</p>`;
}

// The design option the card picked, redrawn from the design file the card names.
function designPart(root, card, level, confirms) {
  const p = pickedOption(root, card);
  if (!p.rel) return '';
  if (!p.design) return `<p class="mute">설계안 파일이 없다(${esc(p.rel)}). 카드 글만 보인다.</p>`;
  if (!p.option) return `<p class="mute">설계안에 ${esc(p.id)}안이 없다(${esc(p.rel)}). 카드 글만 보인다.</p>`;
  const asked = confirms.find((c) => c.user.startsWith(`고른 ${p.id}안`));
  return `<h3>${esc(p.option.id)}. ${esc(p.option.name)}</h3>${confirmPart(p, asked)}${optionRows(p.option, level)}${src(p.rel)}`;
}

function pickedStep(root, card, level, confirms) {
  const { text, reason } = pick(card);
  const shown = [text && `안: ${text}`, reason && `이유: ${reason}`].filter(Boolean);
  return step('고른 안', `${shown.length ? `<pre>${esc(shown.join('\n'))}</pre>` : NONE}${src('작업 카드 ## interface 결정')}${designPart(root, card, level, confirms)}`);
}

const EVIDENCE_DIR = '.quality/evidence';
const MARK = { '✔': '통과', '✖': '실패' };

// The last record of each check: its log lines and whether it ran on the current tree.
function testRecords(root, checks, treeHash) {
  return checks.map((name) => {
    try {
      const ev = JSON.parse(fs.readFileSync(path.join(root, EVIDENCE_DIR, `${name}.json`), 'utf8'));
      const log = fs.readFileSync(path.join(root, ev.logPath), 'utf8').split('\n').map((l) => l.trim());
      return { logPath: ev.logPath, log, isStale: ev.treeHash !== treeHash };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

// A test name cut with "…" matches on the part before it; a whole name must end where the log's name ends.
function testState(records, name) {
  const cut = name.endsWith('…');
  const want = cut ? name.slice(0, -1) : name;
  for (const r of records) {
    for (const line of r.log) {
      const state = MARK[line[0]];
      const rest = line.slice(2);
      if (state && rest.startsWith(want) && (cut || /^(\s\(|$)/.test(rest.slice(want.length)))) return { state, record: r };
    }
  }
  return { state: '찾지 못함' };
}

function evidenceStep(root, { card, cardPath, checks, treeHash }) {
  const lines = items(card, SECTIONS.success);
  const red = require('./red-check').readRedCheck(root, treeHash);
  const spec = cardPath ? require('./spec-check').recordLine(root, { rel: cardPath, text: card }) : null;
  const specPart = spec ? `<h3>명세 대조</h3><p>${esc(spec)}</p>${src('.quality/evidence/spec-check/records.json')}` : '';
  const redPart = `${specPart}<h3>실패 재현</h3><p><b>${esc(red.state)}</b> ${esc(red.detail)}</p>${red.envError ? `<p class="msg warn">환경 오류: ${esc(red.envError)}</p>` : ''}${src('.quality/evidence/red-check.json')}`;
  if (!lines.length) return step('테스트 증거', `${redPart}${NONE}${src('작업 카드 ## 성공 조건 → 검사')}`);
  const records = testRecords(root, checks, treeHash);
  const found = [];
  const rows = lines.map((l) => {
    const name = (l.match(/"([^"]+)"\s*$/) || [])[1];
    const t = name ? testState(records, name) : { state: '찾지 못함' };
    if (t.record) found.push(t.record);
    return `<li><b>${t.state}</b> ${esc(l)}</li>`;
  });
  const warn = !records.length ? '<p class="msg warn">테스트 기록이 없다. 검사를 돌리면 채워진다.</p>'
    : (found.length ? found : records).some((r) => r.isStale) ? '<p class="msg warn">지금 코드보다 오래된 기록이다. 검사를 다시 돌려야 지금 결과다.</p>' : '';
  const logs = [...new Set(records.map((r) => r.logPath))].join(', ');
  return step('테스트 증거', `${redPart}${warn}<ul>${rows.join('')}</ul>${src('작업 카드 ## 성공 조건 → 검사')}${logs ? src(logs) : ''}`);
}

function findingsStep(findings) {
  if (findings === null) return step('리뷰 지적', `<p>검토 생략 (사용자가 검토 생략을 골랐다)</p>${src('qh 질문 답')}`);
  const rows = findings.map((f) => `<li><b>${esc(f.severity || '-')}</b> ${esc(`${f.file}:${f.line}`)} — ${esc(f.reason)}${f.nextAction ? `<br><span class="mute">다음: ${esc(f.nextAction)}</span>` : ''}</li>`);
  return step('리뷰 지적', `${rows.length ? `<ol>${rows.join('')}</ol>` : '<p>지적 없음</p>'}${src('AI 리뷰 결과')}`);
}

function leftStep(card, confirms) {
  const open = [...decisions(card).open, ...confirms.map((c) => c.user)];
  const unsure = lines(card, SECTIONS.unsure);
  return step('남은 판단', `<h3>답하지 않은 질문</h3>${list(open)}${src('작업 카드 ## 판단 필요')}<h3>미확인</h3>${list(unsure)}${src('작업 카드 ## 미확인')}`);
}

// card: the task card text ('' when absent); cardPath: its path (the spec check record key); changed: the changed file names; checks: the check names whose
// logs hold test results; findings: null = review skipped.
function writeReviewPage(root, { base, treeHash, level, card, cardPath, changed, checks, findings }) {
  const confirms = pendingConfirms(root, { card });
  const body = `<h1>완료 리뷰</h1><p class="mute">위에서 아래로 읽습니다. 모든 내용은 기록에서 그대로 가져왔습니다.</p>
${changedStep(root, { base, card, changed })}${pickedStep(root, card, level, confirms)}${evidenceStep(root, { card, cardPath, checks, treeHash })}${step('에이전트가 작업 카드에서 면제한 것', `${list(declaredWaivers(card, root, changed))}${src('작업 카드')}`)}${findingsStep(findings)}${leftStep(card, confirms)}`;
  const file = write(root, 'review.html', shell('완료 리뷰', body, DRAW));
  fs.copyFileSync(path.join(__dirname, MERMAID_FILE), path.join(path.dirname(file), MERMAID_FILE));
  return file;
}

module.exports = { writeReviewPage };
