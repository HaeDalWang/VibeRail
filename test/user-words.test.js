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
  const screens = {
    질문: fs.readFileSync(ask(root, { answers: {} }), 'utf8'),
    결과지: page('demo', [{ date: '2026-11-01', sha: 'abc' }], GROUPS),
    '설계안 선택': fs.readFileSync(view.stdout.match(/(\S+\.html)/)[1], 'utf8'),
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

test('the sentences qh gives the agent to say hold no developer words either', () => {
  const t = triage(everyKind({ isFirstInstall: false, summary: '켜진 검사: unit' }));
  for (const item of [...t.human, ...t.env, ...t.warnings]) assert.doesNotMatch(item.user.replace('"/api/users"', ''), /\b(TDD|ADR|PR|CI|API|Stop|express)\b|에이전트|커밋/, item.user);
});
