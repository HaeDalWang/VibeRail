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
      assert.doesNotMatch(item.user, DEVELOPER_WORDS, item.user);
    }
  }
});
