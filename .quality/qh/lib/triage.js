'use strict';

// Sorts what is left into who must act: the agent (aiFix), a person (human), nobody
// (env), or nobody yet (warnings). Every item for a person carries two sentences:
// `agent` with the paths and commands the agent needs, and `user` the agent can say to
// a non-developer as is: what is to be decided and what each choice leads to, with no
// file paths, commands, commit hashes or tool names.

const ACCESS_FILE = '.quality/access.json';

const item = (agent, user) => ({ agent, user });

const CHECK_ENV_WORDS = {
  tool: (n) => `"${n}" 검사에 필요한 프로그램이 이 컴퓨터에 없어 검사를 못 했습니다. 설치하면 다시 검사합니다. 코드는 고치지 않았습니다.`,
  timeout: (n) => `"${n}" 검사가 정해진 시간 안에 끝나지 않았습니다. 시간 제한을 늘릴지, 이 검사는 올리기 직전에만 돌릴지 정해 주세요.`,
  changed: (n) => `"${n}" 검사가 돌면서 프로젝트 파일을 바꿔서 결과를 믿을 수 없습니다. 검사가 만드는 파일을 기록 대상에서 뺄지, 다른 곳에 쓰게 할지 정해 주세요.`,
  builtin: (n) => `"${n}" 검사에 필요한 실행 환경(앱 실행, 데이터베이스 등)이 준비되지 않아 검사를 못 했습니다. 환경을 켜면 다시 검사합니다.`,
};
const checkEnvUser = (c) => (CHECK_ENV_WORDS[c.envKind] || CHECK_ENV_WORDS.builtin)(c.name);

function setupEnvUser(text) {
  if (text.startsWith('설정:')) return '품질 검사 설정에 잘못 적힌 곳이 있어 검사를 못 했습니다. 설정을 고칠지 정해 주세요. 고치기 전까지는 검사 결과가 없습니다.';
  if (text.startsWith('기준 ref')) return '무엇이 바뀌었는지 비교할 기준 브랜치를 이 컴퓨터에서 찾지 못해 판정을 못 했습니다. 기준 브랜치를 내려받을지, 다른 브랜치를 기준으로 삼을지 정해 주세요.';
  return '검사를 돌릴 환경에 문제가 있어 판정을 못 했습니다. 코드는 고치지 않았습니다.';
}

// "작업 질문(risk, files): "question" A. a (ADR 필수) / B. b → …" from lib/questions.js.
const TASK_QUESTION = /^작업 질문\([^)]*\): "([^"]+)" A\. (.+?) \(ADR 필수\) \/ B\. (.+?) → /;
function taskQuestionUser(text) {
  const m = text.match(TASK_QUESTION);
  if (!m) return '이번 작업이 중요한 영역의 동작을 바꾸는지 정해 주세요. 바꾼다면 그 이유를 설계 기록으로 남깁니다.';
  return `${m[1]} A(${m[2]})를 고르면 그 이유를 설계 기록으로 남기고, B(${m[3]})를 고르면 그대로 진행합니다.`;
}

function criteriaUser(criteria) {
  const summary = criteria?.summary ? ` (${criteria.summary})` : '';
  if (criteria?.isFirstInstall) return `품질 검사 설정이 새로 생겼습니다${summary}. 이대로 쓸지 정해 주세요. 그대로 쓰면 다음부터 묻지 않고, 아니면 무엇을 빼거나 더할지 말해 주세요.`;
  return `무엇을 검사하고 무엇을 막을지 정한 기준이 이번 작업에서 바뀌었습니다${summary}. 이대로 쓸지 정해 주세요. 그대로 쓰면 다음부터 묻지 않고, 아니면 원래대로 되돌립니다.`;
}

function checkItems(a, allowed) {
  const aiFix = [];
  const warnings = [];
  for (const c of a.checks) {
    if (c.state === '미실행') aiFix.push(`검사 ${c.name}: 미실행 → \`qh check ${c.name}\` 실행`);
    if (c.state === '실패' && allowed.has(c.name)) {
      warnings.push(item(`검사 ${c.name}: 실패 (결정 로그의 기존 실패 허용, 막지 않음)\n    ${(c.detail || []).join('\n    ')}`, `"${c.name}" 검사는 이 작업 전부터 실패하던 것이라 이번에는 막지 않았습니다. 따로 고칠 일로 남아 있습니다.`));
    } else if (c.state === '실패') {
      aiFix.push(`검사 ${c.name}: 실패${c.isCurrent === false ? '(이전 상태)' : ''} → 고친 뒤 \`qh check ${c.name}\` (이 작업 전부터 실패하면 ask-guide.md "기존 실패 허용")\n    ${(c.detail || []).join('\n    ')}`);
    }
    if (c.state === '이전 상태에서 통과') aiFix.push(`검사 ${c.name}: 이전 상태에서 통과 → 그 뒤 코드가 바뀌었으니 \`qh check ${c.name}\` 재실행`);
  }
  return { aiFix, warnings };
}

function triage(a) {
  const { aiFix, warnings } = checkItems(a, new Set(a.allowedFailures || []));
  for (const d of a.docsMissing) aiFix.push(`문서 미갱신: ${d.doc} (위험 ${d.risk}의 연동 문서) → 같은 작업에서 갱신`);
  aiFix.push(...a.policy, ...a.structure);
  const human = [
    ...a.undeclared.map((r) => item(
      `${r}: 접근 수준 미선언 → 누가 접근할 수 있는지 사용자에게 묻고, 답을 받은 뒤 ${ACCESS_FILE}의 routes에 적기`,
      `새로 생긴 화면이나 기능 주소 하나에 누가 들어올 수 있는지 정해지지 않았습니다. 누구나, 로그인한 회원만, 관리자만 중에서 골라 주세요. 고른 대로 막혀 있는지 검사합니다.`,
    )),
    ...a.decisions.map((d) => item(`작업 카드: ${d} → 사용자에게 묻고, 답을 받으면 \`- [x]\`로 바꾼다`, `정해 주세요: ${d}`)),
    ...a.taskQuestions.map((q) => item(q, taskQuestionUser(q))),
    ...a.configChanges.map((c) => item(`기준 변경(사람 확인 필요): ${c}`, criteriaUser(a.criteria))),
  ];
  const env = [
    ...a.env.map((e) => item(e, setupEnvUser(e))),
    ...(a.structureEnv || []).map((e) => item(e, '코드 구조를 살피는 도구를 돌리지 못했습니다. 도구를 설치할지, 그 검사를 끌지 정해 주세요.')),
    ...a.checks.filter((c) => c.state === '환경 오류').map((c) => item(`검사 ${c.name}: ${c.detail.join(' ')}`, checkEnvUser(c))),
    ...(a.phase === 'pr' && a.review?.state === '환경 오류' ? [item(`AI 리뷰: ${a.review.detail.join(' ')}`, 'AI 리뷰를 돌리지 못했습니다. 리뷰를 맡을 도구의 설정을 고칠지, 이번에는 리뷰 없이 갈지 정해 주세요.')] : []),
  ];
  warnings.push(...(a.structureWarnings || []).map((w) => item(w, '이번에 만진 파일에 원래부터 있던 중복 코드가 있습니다. 막지는 않았고, 정리할지는 나중에 정해도 됩니다.')));
  return { aiFix, human, env, warnings };
}

module.exports = { triage, ACCESS_FILE };
