'use strict';

// Every item for a person carries two sentences: one for the agent (paths, commands) and one
// the agent can say to a non-developer as is.

const test = require('node:test');
const assert = require('node:assert');
const { triage } = require('../lib/triage');
const { pendingTaskQuestions } = require('../lib/questions');

const DEVELOPER_WORDS = /\S\/|\/\S|\.json\b|\b[0-9a-f]{7,}\b|`|\bgit |qh/i;

// One of every kind of item a person sees: questions, base changes, environment errors, warnings.
function everyKind(criteria) {
  return {
    phase: 'pr',
    checks: [
      { name: 'unit', state: '환경 오류', envKind: 'tool', detail: ['도구 없음: ./node_modules/.bin/jest'] },
      { name: 'slow', state: '환경 오류', envKind: 'timeout', detail: ['시간 초과 (로그: .quality/evidence/slow.log)'] },
      { name: 'gen', state: '환경 오류', envKind: 'changed', detail: ['검사가 파일을 바꿨다: out/a.txt'] },
      { name: 'routes', state: '환경 오류', envKind: 'builtin', detail: ['connect ECONNREFUSED 127.0.0.1:5432'] },
      { name: 'old', state: '실패', isCurrent: true, detail: ['exit 1 (로그: .quality/evidence/old.log)'] },
    ],
    allowedFailures: ['old'],
    docsMissing: [],
    policy: [],
    structure: [],
    structureWarnings: ['중복(원래 있던 것, 막지 않음): src/old.js:1 ↔ src/mail.js:1 (의미 있는 줄 6줄 이상 같음)'],
    undeclared: ['GET /api/users'],
    decisions: ['관리자는 모든 회사를 보나?'],
    taskQuestions: pendingTaskQuestions([{ risk: 'auth', files: ['src/auth.js'] }, { risk: '결제', files: ['src/pay/a.js'] }], ''),
    configChanges: ['checks.unit.cmd: "npm test" → "true"', '.quality/baseline.json 처음 기록'],
    criteria,
    env: ['설정: common의 "lint"이 checks에 없다 → checks에 정의하거나 common에서 뺀다', '기준 ref "origin/main"가 이 저장소에 없다 (fetch 필요 또는 config.baseRef 확인)'],
    structureEnv: ['knip 실행 실패: node_modules/.bin/knip'],
    review: { state: '환경 오류', detail: ['리뷰 결과(result.json)가 없거나 형식이 틀림 (exit 0, 로그 .quality/evidence/review/run.log)'] },
  };
}

test('every item for a person has a sentence without paths, commands, hashes or tool names', () => {
  for (const criteria of [{ isFirstInstall: true, summary: '켜진 검사: unit · 지키는 위험 영역: auth' }, { isFirstInstall: false, summary: '켜진 검사: unit' }]) {
    const t = triage(everyKind(criteria));
    const items = [...t.human, ...t.env, ...t.warnings];
    assert.strictEqual(t.human.length, 1 + 1 + 2 + 2, 'route, decision, two task questions, two base changes');
    assert.strictEqual(t.env.length, 4 + 2 + 1 + 1, 'four check kinds, two setup kinds, structure tool, review');
    assert.strictEqual(t.warnings.length, 2, 'allowed failure, old copy');
    for (const item of items) {
      assert.ok(item.agent, JSON.stringify(item));
      assert.ok(item.user, JSON.stringify(item));
      // A route question names its address: that is what the person decides about.
      assert.doesNotMatch(item.user.replace('"/api/users"', ''), DEVELOPER_WORDS, item.user);
    }
  }
});

// The three screens a non-developer opens (A level): question page, measure report, interface choice.
// Developer words stay out of the page text; level B may show them in its own detail block.
const fs = require('node:fs');
const { ask } = require('../lib/ask');
const { GROUPS } = require('../lib/measure');
const { page } = require('../lib/measure-page');
const { repo, write, qh, BASIC } = require('./helpers');

const SCREEN_WORDS = /\b(TDD|ADR|PR|CI|API|Stop|express|SQL)\b|에이전트|커밋|\.quality|docs\/|\.(json|csv|mjs|md)\b/;

test('A-level question page, measure report and interface screen contain no developer words', () => {
  const root = repo({ ...BASIC, answers: { level: { choice: 'A' } } }, { 'package.json': JSON.stringify({ dependencies: { express: '^4' } }) });
  write(root, 'opts.json', JSON.stringify({ title: '주문 묶기', options: [{ id: 'A', name: '하나로', summary: '묶는다', mermaid: 'graph TD\n  A-->B', gain: '단순', cost: '커진다' }, { id: 'B', name: '둘로', summary: '나눈다', mermaid: 'graph TD\n  A-->C', gain: '작음', cost: '늘어남' }] }));
  const view = qh(root, ['view', 'interface', 'opts.json']);
  write(root, 'cands.json', JSON.stringify({ title: '구조 점검', candidates: [{ id: '1', name: '합치기', problem: '흩어져 있다', solution: '모은다', gain: '단순', cost: '많이 옮긴다', strength: '높음', mermaidBefore: 'graph TD\n  A-->B' }] }));
  const arch = qh(root, ['view', 'architecture', 'cands.json']);
  const screens = {
    질문: fs.readFileSync(ask(root, { answers: {} }), 'utf8'),
    결과지: page('demo', [{ date: '2026-11-01', sha: 'abc' }], GROUPS),
    '설계안 선택': fs.readFileSync(view.stdout.match(/(\S+\.html)/)[1], 'utf8'),
    '구조 점검': fs.readFileSync(arch.stdout.match(/(\S+\.html)/)[1], 'utf8'),
  };
  for (const [name, html] of Object.entries(screens)) {
    const text = html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script id="pure">[\s\S]*?<\/script>/, '');
    const hits = [...new Set(text.match(new RegExp(SCREEN_WORDS, 'g')))];
    assert.deepStrictEqual(hits, [], `${name} 화면에 전문용어: ${hits}`);
    // The product is VibeRail to a person; "qh 답" is only the marker the agent reads back.
    const names = text.replace(/qh 답/g, '').replace(/^\s*\/\/.*$/gm, '').match(/\bqh\b(?!-)[^<'"\n]{0,20}/g) || [];
    assert.deepStrictEqual(names, [], `${name} 화면에 qh라는 이름`);
  }
});

// The report is drawn by inline script: run it against a stub page and read the text it writes.
function runtimeText(html) {
  const els = {};
  const document = { getElementById: (id) => (els[id] ||= {}) };
  require('node:vm').runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1], { document });
  return Object.values(els).map((e) => `${e.textContent || ''} ${e.innerHTML || ''}`).join('\n').replace(/<[^>]*>/g, ' ');
}

test('the measure report text drawn at runtime has no commit hash and no developer words', () => {
  const rows = [
    { date: '2026-11-01', sha: 'f41eecd', rules: 1, files_over_800: '2', duplicated_pct: '4' },
    { date: '2026-11-10', sha: '4551074', rules: 1, files_over_800: '1', duplicated_pct: '3', withQh: true },
  ];
  const text = runtimeText(page('demo', rows, GROUPS));
  assert.match(text, /기간: 11\/1 ~ 11\/10/, 'the page really ran');
  assert.doesNotMatch(text, /\b[0-9a-f]{7,}\b/, 'no commit hash');
  assert.doesNotMatch(text, SCREEN_WORDS);
});

test('the sentences qh gives the agent to say hold no developer words either', () => {
  const t = triage(everyKind({ isFirstInstall: false, summary: '켜진 검사: unit' }));
  for (const item of [...t.human, ...t.env, ...t.warnings]) assert.doesNotMatch(item.user.replace('"/api/users"', ''), /\b(TDD|ADR|PR|CI|API|Stop|express)\b|에이전트|커밋/, item.user);
});

test('the probe question and the generic fix sentence say AI, not 에이전트', () => {
  const t = triage({ ...everyKind(null), checks: [{ name: 'p', state: '환경 오류', envKind: 'probe-todo', detail: ['todo'] }], taskQuestions: [], undeclared: [], decisions: [], configChanges: [], env: [], structureEnv: [], review: null, policy: ['알 수 없는 종류: x'] });
  for (const x of [...t.human, ...t.aiFix.map((a) => ({ user: require('../lib/triage').aiFixUser(a, {}) }))]) assert.doesNotMatch(x.user, /에이전트/, x.user);
});

test('a card decision written as a question is shown as is; a bare note gets "정해 주세요"', () => {
  const human = (d) => triage({ ...everyKind(null), decisions: [d] }).human.find((x) => x.agent.startsWith('작업 카드')).user;
  assert.strictEqual(human('이 범위로 만들까요?'), '이 범위로 만들까요?');
  assert.strictEqual(human('범위 확인'), '정해 주세요: 범위 확인');
});
