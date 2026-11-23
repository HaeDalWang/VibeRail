'use strict';

// The review page qh review writes for ◆③: the existing records laid out in reading order
// (무엇이 바뀜 → 고른 안 → 테스트 증거 → 리뷰 지적 → 남은 판단). Nothing here is written by an AI;
// every item is copied from a record and names its source.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { esc } = require('./ask');
const { section, SECTIONS } = require('./card');
const { shell, write, optionRows, DRAW, MERMAID_FILE } = require('./view');

const NONE = '<p class="mute">기록 없음</p>';
const src = (s) => `<p class="mute">출처: ${esc(s)}</p>`;
const list = (items) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : NONE);
const step = (title, body) => `<article><h2>${title}</h2>${body}</article>`;
const cardLines = (card, name) => (section(card, name) || '').split('\n').map((l) => l.trim()).filter(Boolean);

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

function readDesign(root, rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  } catch {
    return null;
  }
}

// The design option the card picked, redrawn from the design file the card names.
function designPart(root, lines, level) {
  const id = (lines.find((l) => l.startsWith('안:')) || '').slice(3).trim().split(/[\s(]/)[0];
  const rel = (lines.find((l) => l.startsWith('설계안:')) || '').slice(4).trim().replace(/`/g, '');
  if (!rel) return '';
  const design = readDesign(root, rel);
  if (!design) return `<p class="mute">설계안 파일이 없다(${esc(rel)}). 카드 글만 보인다.</p>`;
  const o = (design.options || []).find((x) => x.id === id);
  if (!o) return `<p class="mute">설계안에 ${esc(id)}안이 없다(${esc(rel)}). 카드 글만 보인다.</p>`;
  return `<h3>${esc(o.id)}. ${esc(o.name)}</h3>${optionRows(o, level)}${src(rel)}`;
}

function pickedStep(root, card, level) {
  const lines = cardLines(card, SECTIONS.interface);
  const pick = lines.filter((l) => /^(안|이유):/.test(l));
  return step('고른 안', `${pick.length ? `<pre>${esc(pick.join('\n'))}</pre>` : NONE}${src('작업 카드 ## interface 결정')}${designPart(root, lines, level)}`);
}

function findingsStep(findings) {
  if (findings === null) return step('리뷰 지적', `<p>검토 생략 (사용자가 검토 생략을 골랐다)</p>${src('qh 질문 답')}`);
  const rows = findings.map((f) => `<li><b>${esc(f.severity || '-')}</b> ${esc(`${f.file}:${f.line}`)} — ${esc(f.reason)}${f.nextAction ? `<br><span class="mute">다음: ${esc(f.nextAction)}</span>` : ''}</li>`);
  return step('리뷰 지적', `${rows.length ? `<ol>${rows.join('')}</ol>` : '<p>지적 없음</p>'}${src('AI 리뷰 결과')}`);
}

function leftStep(card) {
  const open = cardLines(card, '판단 필요').filter((l) => l.startsWith('- [ ] ')).map((l) => l.slice(6));
  const unsure = cardLines(card, '미확인').map((l) => l.replace(/^[-*+]\s+/, ''));
  return step('남은 판단', `<h3>답하지 않은 질문</h3>${list(open)}${src('작업 카드 ## 판단 필요')}<h3>미확인</h3>${list(unsure)}${src('작업 카드 ## 미확인')}`);
}

// card: the task card text ('' when absent); changed: the changed file names; findings: null = review skipped.
function writeReviewPage(root, { base, level, card, changed, findings }) {
  const body = `<h1>완료 리뷰</h1><p class="mute">위에서 아래로 읽습니다. 모든 내용은 기록에서 그대로 가져왔습니다.</p>
${changedStep(root, { base, card, changed })}${pickedStep(root, card, level)}${step('테스트 증거', NONE)}${findingsStep(findings)}${leftStep(card)}`;
  const file = write(root, 'review.html', shell('완료 리뷰', body, DRAW));
  fs.copyFileSync(path.join(__dirname, MERMAID_FILE), path.join(path.dirname(file), MERMAID_FILE));
  return file;
}

module.exports = { writeReviewPage };
