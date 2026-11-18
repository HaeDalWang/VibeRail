'use strict';

// Sorts what is left into who must act: the agent (aiFix), a person (human), nobody
// (env), or nobody yet (warnings). Every item for a person carries two sentences:
// `agent` with the paths and commands the agent needs, and `user` the agent can say to
// a non-developer as is: what is to be decided and what each choice leads to, with no
// file paths, commands, commit hashes or tool names. aiFix items are the agent's alone;
// aiFixUser says one in plain words when the agent gave up on it.

const ACCESS_FILE = '.quality/access.json';
const PROBE_FILE = '.quality/probe.mjs';

const item = (agent, user) => ({ agent, user });

// ---------- plain names ----------

// What a check does, never its key: "test-work" means nothing to the person.
const PROJECT_CHECK = '프로젝트 검사';
const CHECK_WORDS = [
  [(d) => d?.builtin === 'sql-prepare', '데이터베이스 쿼리 점검'],
  [(d) => d?.builtin === 'route-access' && d.requests === false, '화면·주소 목록 확인'],
  [(d) => d?.builtin === 'route-access', '화면·주소별 접근 권한 확인'],
  [(d) => d?.cmd?.includes('{tests}'), '바뀐 코드의 테스트'],
  [(d) => /\b(npm|pnpm|yarn|bun)( run)? test\b|\bpytest\b|\bgo test\b|\bcargo test\b|node --test/.test(d?.cmd || ''), '전체 테스트'],
  [(d) => /\b(es)?lint\b/.test(d?.cmd || ''), '코드 규칙 점검'],
];
const checkLabel = (def) => (CHECK_WORDS.find(([is]) => is(def)) || [null, PROJECT_CHECK])[1];
const labelOf = (config, name) => checkLabel(config?.checks?.[name]);

const RISK_WORDS = { auth: '로그인·권한', db: '데이터베이스', external: '외부 서비스 연동', personal: '개인정보', payment: '결제', deploy: '배포' };
// A risk named in Korean is already a word; another key is only counted.
const isPlainName = (name) => /[^\x00-\x7f]/.test(name);

function riskWords(names) {
  const named = names.map((n) => RISK_WORDS[n] || (isPlainName(n) ? n : null));
  const others = named.filter((n) => n === null).length;
  return [...named.filter(Boolean), ...(others ? [`그 밖의 중요 영역 ${others}곳`] : [])].join(', ');
}

// The criteria in words a non-developer can answer "is this what you want?" about.
function criteriaWords(config, routes) {
  const labels = Object.values(config.checks || {}).map(checkLabel);
  const others = labels.filter((l) => l === PROJECT_CHECK).length;
  const checks = [...new Set(labels.filter((l) => l !== PROJECT_CHECK)), ...(others ? [`${PROJECT_CHECK} ${others}개`] : [])];
  const parts = [checks.length ? `켜진 검사: ${checks.join(', ')}` : '아직 켜 둔 자동 검사가 없음'];
  const risks = riskWords(Object.keys(config.risks || {}));
  if (risks) parts.push(`특히 지키는 코드: ${risks}`);
  if (routes) parts.push(`누가 어느 화면·주소에 들어갈 수 있는지 적은 목록(주소 ${routes}개)`);
  return parts.join(' · ');
}

// ---------- sentences for the person ----------

const CHECK_ENV_WORDS = {
  tool: (l) => `검사(${l})에 필요한 프로그램이 이 컴퓨터에 없어 검사를 못 했습니다. 설치하면 다시 검사합니다. 코드는 고치지 않았습니다.`,
  timeout: (l) => `검사(${l})가 정해진 시간 안에 끝나지 않았습니다. 시간 제한을 늘릴지, 이 검사는 올리기 직전에만 돌릴지 정해 주세요.`,
  changed: (l) => `검사(${l})가 돌면서 프로젝트 파일을 바꿔서 결과를 믿을 수 없습니다. 검사가 만드는 파일을 기록 대상에서 뺄지, 다른 곳에 쓰게 할지 정해 주세요.`,
  service: (l) => `검사(${l})가 데이터베이스 같은 필요한 프로그램에 연결하지 못해 검사를 못 했습니다. 그 프로그램을 켜면 다시 검사합니다. 코드는 고치지 않았습니다.`,
  builtin: (l) => `검사(${l})에 필요한 실행 환경(앱 실행, 데이터베이스 등)이 준비되지 않아 검사를 못 했습니다. 환경을 켜면 다시 검사합니다.`,
};
const checkEnvUser = (c, config) => (CHECK_ENV_WORDS[c.envKind] || CHECK_ENV_WORDS.builtin)(labelOf(config, c.name));

const PROBE_TODO_USER = '앱을 어떻게 띄우고 로그인하는지 적어 두는 설정이 아직 비어 있어 검사 일부를 못 했습니다. 에이전트가 채워도 될까요? 채우면 그 검사를 시작하고, 아니면 그 검사는 꺼 둡니다.';

function setupEnvUser(text) {
  if (text.startsWith('설정:')) return '품질 검사 설정에 잘못 적힌 곳이 있어 검사를 못 했습니다. 설정을 고칠지 정해 주세요. 고치기 전까지는 검사 결과가 없습니다.';
  if (text.startsWith('커밋 없음')) return '프로젝트를 아직 한 번도 저장(커밋)하지 않아 무엇이 바뀌었는지 비교할 기준이 없습니다. 첫 저장 뒤부터 검사합니다. 지금 저장할지 정해 주세요.';
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

const METHOD_WORDS = { GET: '보기', POST: '새로 만들기', PUT: '고치기', PATCH: '고치기', DELETE: '지우기' };
const DEFAULT_LEVELS = '누구나, 로그인한 회원만, 관리자만';

// The address itself is what is decided, so it stays in; the levels are this project's own.
function routeUser(route, levels) {
  const [method, address] = route.includes(' ') ? [route.slice(0, route.indexOf(' ')), route.slice(route.indexOf(' ') + 1)] : ['', route];
  const what = METHOD_WORDS[method] ? `(${METHOD_WORDS[method]})` : '';
  const choices = levels?.length ? levels.join(', ') : DEFAULT_LEVELS;
  return `새로 생긴 주소 "${address}"${what}에 누가 들어올 수 있는지 정해지지 않았습니다. ${choices} 중에서 골라 주세요. 고른 대로 막혀 있는지 검사합니다.`;
}

// aiFix items start with "<kind>: ". Unknown kinds still get a sentence.
const AI_FIX_WORDS = [
  [/^TDD$/, '코드가 바뀌었는데 그 동작을 확인하는 테스트가 없습니다.'],
  [/^문서 영향$/, '코드가 바뀌었는데 설명 문서가 그대로입니다.'],
  [/^ADR$/, '중요한 영역이 바뀌었는데 왜 그렇게 바꿨는지 적은 설계 기록이 없습니다.'],
  [/^결정 로그$/, '품질 기준이 바뀌었는데 그 결정을 기록하지 않았습니다.'],
  [/^개인정보 로그$/, '기록(로그)에 개인정보가 남을 수 있는 곳이 있습니다.'],
  [/^연동 실패 테스트$/, '외부 서비스가 실패할 때를 확인하는 테스트가 없습니다.'],
  [/^비밀값 기록$/, '이번 작업의 저장 기록에 비밀 키로 보이는 값이 남아 있습니다. 기록에서 지우고 그 키를 새로 바꾸는 것이 안전합니다.'],
  [/^비밀값/, '비밀 키나 비밀번호로 보이는 값이 코드나 올라갈 파일에 들어 있습니다.'],
  [/^중복/, '이미 있는 코드와 거의 같은 코드가 생겼습니다.'],
  [/^큰 파일$/, '파일 하나가 정해진 길이보다 길어졌습니다.'],
  [/^(루트 파일|정리 대상 폴더|금지 위치)$/, '새 파일이 정해진 자리가 아닌 곳에 생겼습니다.'],
  [/^죽은 링크$/, '문서 속 링크가 없는 곳을 가리킵니다.'],
  [/^문서 증가$/, '문서가 너무 많이 늘어났습니다.'],
  [/^(문서 규칙|주석 규칙|함수 모양)/, '프로젝트가 정한 코드·문서 작성 규칙에 어긋난 곳이 있습니다.'],
  [/^문서 미갱신$/, '중요한 영역에 딸린 문서가 갱신되지 않았습니다.'],
  [/^의도$/, '이번 작업이 무엇을 왜 만드는지 정리해 둔 기록이 없습니다.'],
  [/^(interface 결정|아키텍처 점검)$/, '구조를 고른 이유가 기록에 없습니다.'],
  [/^작업 카드$/, '작업 기록에 사람이 정할 일이 정해진 모양으로 적혀 있지 않습니다.'],
];
const AI_FIX_OTHER = '에이전트가 고칠 품질 문제가 하나 남아 있습니다.';

// "검사 <name>" items: named by what the check does.
function checkFixUser(name, rest, config) {
  const label = labelOf(config, name);
  if (rest.startsWith('실패')) return `검사(${label})가 실패합니다.`;
  return `검사(${label})를 마지막 변경 뒤에 다시 돌리지 않았습니다.`;
}

// The kind an aiFix item is about: the text before its first colon ("TDD", "검사 unit").
const aiFixKind = (text) => text.split('\n')[0].split(':')[0].trim();

function aiFixUser(text, config) {
  const kind = aiFixKind(text);
  const check = kind.match(/^검사 (.+)$/);
  if (check) return checkFixUser(check[1], text.slice(text.indexOf(':') + 1).trim(), config);
  return (AI_FIX_WORDS.find(([re]) => re.test(kind)) || [null, AI_FIX_OTHER])[1];
}

// ---------- sorting ----------

function checkItems(a, allowed) {
  const aiFix = [];
  const warnings = [];
  for (const c of a.checks) {
    if (c.state === '미실행') aiFix.push(`검사 ${c.name}: 미실행 → \`qh check ${c.name}\` 실행`);
    if (c.state === '실패' && allowed.has(c.name)) {
      warnings.push(item(`검사 ${c.name}: 실패 (결정 로그의 기존 실패 허용, 막지 않음)\n    ${(c.detail || []).join('\n    ')}`, `검사(${labelOf(a.config, c.name)})는 이 작업 전부터 실패하던 것이라 이번에는 막지 않았습니다. 따로 고칠 일로 남아 있습니다.`));
    } else if (c.state === '실패') {
      aiFix.push(`검사 ${c.name}: 실패${c.isCurrent === false ? '(이전 상태)' : ''} → 고친 뒤 \`qh check ${c.name}\` (이 작업 전부터 실패하면 ask-guide.md "기존 실패 허용")\n    ${(c.detail || []).join('\n    ')}`);
    }
    if (c.state === '이전 상태에서 통과') aiFix.push(`검사 ${c.name}: 이전 상태에서 통과 → 그 뒤 코드가 바뀌었으니 \`qh check ${c.name}\` 재실행`);
  }
  return { aiFix, warnings };
}

const probeTodoItem = (c) => item(
  `검사 ${c.name}: ${c.detail.join(' ')} → 사용자에게 채워도 되는지 묻고, 허락을 받은 뒤에만 ${PROBE_FILE}를 채운다(앱 만들기·로그인·테스트 DB). 아니라고 하면 이 검사를 끌지 사용자와 정한다`,
  PROBE_TODO_USER,
);

function triage(a) {
  const { aiFix, warnings } = checkItems(a, new Set(a.allowedFailures || []));
  for (const d of a.docsMissing) aiFix.push(`문서 미갱신: ${d.doc} (위험 ${d.risk}의 연동 문서) → 같은 작업에서 갱신`);
  aiFix.push(...a.policy, ...a.structure);
  const envChecks = a.checks.filter((c) => c.state === '환경 오류');
  const levels = a.accessLevels?.length ? ` (수준: ${a.accessLevels.join(', ')})` : '';
  const human = [
    ...a.undeclared.map((r) => item(
      `${r}: 접근 수준 미선언${levels} → 누가 접근할 수 있는지 사용자에게 묻고, 답을 받은 뒤 ${ACCESS_FILE}의 routes에 적기`,
      routeUser(r, a.accessLevels),
    )),
    ...envChecks.filter((c) => c.envKind === 'probe-todo').map(probeTodoItem),
    ...a.decisions.map((d) => item(`작업 카드: ${d} → 사용자에게 묻고, 답을 받으면 \`- [x]\`로 바꾼다`, `정해 주세요: ${d}`)),
    ...a.taskQuestions.map((q) => item(q, taskQuestionUser(q))),
    ...a.configChanges.map((c) => item(`기준 변경(사람 확인 필요): ${c}`, criteriaUser(a.criteria))),
  ];
  const env = [
    ...a.env.map((e) => item(e, setupEnvUser(e))),
    ...(a.structureEnv || []).map((e) => item(e, '코드 구조를 살피는 도구를 돌리지 못했습니다. 도구를 설치할지, 그 검사를 끌지 정해 주세요.')),
    ...envChecks.filter((c) => c.envKind !== 'probe-todo').map((c) => item(`검사 ${c.name}: ${c.detail.join(' ')}`, checkEnvUser(c, a.config))),
    ...(a.phase === 'pr' && a.review?.state === '환경 오류' ? [item(`AI 리뷰: ${a.review.detail.join(' ')}`, 'AI 리뷰를 돌리지 못했습니다. 리뷰를 맡을 도구의 설정을 고칠지, 이번에는 리뷰 없이 갈지 정해 주세요.')] : []),
  ];
  warnings.push(...(a.structureWarnings || []).map((w) => item(w, '이번에 만진 파일에 원래부터 있던 중복 코드가 있습니다. 막지는 않았고, 정리할지는 나중에 정해도 됩니다.')));
  warnings.push(...(a.policyWarnings || []).map((w) => item(w, '새로 만든 이름이 용어집에 없습니다. 막지는 않았고, 용어집에 넣을지 나중에 정해도 됩니다.')));
  return { aiFix, human, env, warnings };
}

module.exports = { triage, aiFixUser, aiFixKind, criteriaWords, checkLabel, ACCESS_FILE };
