'use strict';

// Project questions: what the product is, asked once after init. Each option says what
// it turns on, what the project gains and what it pays, so whoever picks knows what
// they decided. The recommendation comes from what qh can see in the repository;
// no answer means the recommendation.
// Option labels are noun/state phrases, not verbs (user rule, also for questions an
// agent writes): 있음/없음 with the subject ("DB 변경 있음"), 대상/제외, 취급함/취급 안 함,
// "연동 있음 / 단독 실행", "팀 협업 개발 / 단독 작업", "리뷰 적용 / 리뷰 생략".

const fs = require('node:fs');
const path = require('node:path');

// Shown, not asked: the line every project keeps (turning one off needs a reason).
const ALWAYS_ON = [
  ['TDD', '코드를 바꾸면 같은 작업에 테스트도 바뀐다. 필요 없으면 이유 한 줄.'],
  ['문서 영향', '코드를 바꾸면 영향받는 문서도 고친다. 없으면 이유 한 줄.'],
  ['ADR', '위험한 곳(권한·DB·외부 연동)을 바꾸면 결정 문서를 남긴다.'],
  ['결정 로그', '품질 기준을 바꾸면 docs/decisions.md에 한 줄.'],
  ['비밀값', '키·토큰·비밀번호가 코드에 들어가면 막는다.'],
  ['중복·구조', '만진 파일의 복사된 코드, 800줄 넘는 파일 키우기, 죽은 링크를 막는다.'],
  ['테스트 통과', 'PR 전에 전체 테스트가 통과해야 한다.'],
];

const QUESTIONS = [
  {
    id: 'login',
    short: '로그인',
    title: '로그인한 사용자만 쓰는 기능이 있나요?',
    why: '사용자마다 볼 수 있는 것이 다르면, 다른 사람 데이터를 보는 실수가 가장 큰 사고가 됩니다.',
    options: [
      { id: 'A', label: '로그인 기능 있음', on: '권한 표 검사: 모든 주소(API)에 누가 접근할 수 있는지 적고, 낮은 권한으로 요청해 거부되는지 확인. 권한을 바꾸는 작업이면 그때 한 번 더 질문', gain: '권한 확인을 빠뜨린 새 API가 PR 전에 막힌다', cost: '새 API마다 접근 수준을 한 줄 적어야 한다. 처음에 표를 한 번 훑어야 한다' },
      { id: 'B', label: '로그인 기능 없음', on: '권한 검사 꺼짐', gain: '설정할 것이 없다', cost: '나중에 로그인이 생겨도 자동으로 켜지지 않는다 → 그때 다시 질문' },
    ],
  },
  {
    id: 'personal',
    short: '개인정보',
    title: '이름·이메일·전화번호 같은 개인정보를 저장하나요?',
    why: '개인정보가 로그나 응답에 새면 되돌릴 수 없습니다.',
    options: [
      { id: 'A', label: '개인정보 취급함', on: '로그 마스킹 검사, 개인정보 항목 문서(docs/personal-data.md), 권한 표 필수', gain: '개인정보가 로그·응답으로 새는 변경을 막는다. 어떤 정보를 어디에 두는지 한 곳에 남는다', cost: '개인정보 항목을 추가할 때마다 문서를 고친다' },
      { id: 'B', label: '개인정보 취급 안 함', on: '개인정보 검사 꺼짐', gain: '설정할 것이 없다', cost: '나중에 저장하기 시작해도 자동으로 켜지지 않는다' },
    ],
  },
  {
    id: 'db',
    short: 'DB 변경',
    title: 'DB 구조(테이블·컬럼)를 바꾸는 일이 있나요?',
    why: 'DB 변경은 배포 뒤 되돌리기 가장 어렵습니다.',
    options: [
      { id: 'A', label: 'DB 변경 있음', on: 'SQL 검사(코드의 SQL을 빈 테스트 DB에서 미리 실행), 마이그레이션은 ADR 필수, DB를 바꾸는 작업이면 그때 질문', gain: '없는 컬럼을 쓰는 SQL이 PR 전에 잡힌다. 왜 바꿨는지 남는다', cost: '테스트 DB 연결을 한 번 설정해야 한다(.quality/probe.mjs). 마이그레이션마다 ADR 한 장' },
      { id: 'B', label: 'DB 변경 없음', on: 'SQL 검사 꺼짐', gain: '설정할 것이 없다', cost: 'SQL 오타는 실행해 봐야 안다' },
    ],
  },
  {
    id: 'external',
    short: '외부 연동',
    title: '외부 서비스(결제·메일·AI·클라우드 API)와 연결하나요?',
    why: '외부 서비스는 느려지거나 실패합니다. 테스트가 실제 서비스를 부르면 돈이 나가거나 데이터가 바뀝니다.',
    options: [
      { id: 'A', label: '외부 API 연동 있음', on: '검사 중 외부망 차단, 연동 실패 테스트 필수, 연동을 바꾸면 ADR 필수', gain: '테스트가 실제 서비스를 부르지 못한다. 상대가 실패할 때의 동작이 확인된다', cost: '연동마다 실패 상황 테스트를 하나씩 쓴다' },
      { id: 'B', label: '단독 실행', on: '연동 검사 꺼짐 (외부망 차단은 내장 검사에서 유지)', gain: '설정할 것이 없다', cost: '-' },
    ],
  },
  {
    id: 'team',
    short: '협업',
    title: '여러 명이 같이 개발하나요?',
    why: '혼자여도 TDD·ADR·결정 로그는 항상 켜져 있습니다. 이 질문은 리뷰와 CI만 정합니다.',
    options: [
      { id: 'A', label: '팀 협업 개발', on: 'PR AI 리뷰 필수, CI에서 qh pr 실행', gain: '누가 올려도 같은 기준으로 막힌다', cost: 'PR마다 리뷰 시간(수 분)과 AI 사용량' },
      { id: 'B', label: '단독 작업', on: 'PR AI 리뷰만 (CI 연결 없음)', gain: '설정이 적다', cost: '내 컴퓨터에서 qh pr을 돌리는 것을 잊으면 아무도 안 막는다' },
    ],
  },
  {
    id: 'reviewer',
    short: 'AI 리뷰',
    title: 'PR AI 리뷰는 어떤 에이전트가 하나요?',
    why: '코드를 쓴 에이전트가 자기 코드를 리뷰하면 같은 실수를 못 보기도 합니다.',
    options: [
      { id: 'A', label: '현재 에이전트 리뷰 적용', on: 'config의 review.cmd를 지금 에이전트로', gain: '추가 설치·비용이 없다', cost: '쓴 쪽과 보는 쪽이 같아 놓치는 것이 겹칠 수 있다' },
      { id: 'B', label: '다른 에이전트 리뷰 적용', on: 'review.cmd를 다른 에이전트로 (직접 지정)', gain: '다른 눈으로 본다', cost: '그 에이전트를 설치·로그인해야 한다' },
      { id: 'C', label: '리뷰 생략', on: 'AI 리뷰 꺼짐', gain: 'PR이 빠르다', cost: '검사로 못 잡는 논리 실수는 사람이 봐야 한다' },
    ],
  },
  {
    id: 'deploy',
    short: '운영 배포',
    title: '운영 환경에 배포하나요?',
    why: '배포 뒤 문제는 사용자가 먼저 겪습니다. 지금은 정책만 기록하고, 자동 검사는 다음 판에서 붙입니다.',
    options: [
      { id: 'A', label: '운영 배포 대상', on: '배포 전 확인 목록·장애 회고 정책을 docs/operations.md에 기록', gain: '배포 때 무엇을 볼지, 사고 뒤 무엇을 남길지 정해져 있다', cost: '문서 한 장을 처음에 채운다' },
      { id: 'B', label: '운영 배포 제외', on: '없음', gain: '-', cost: '-' },
    ],
  },
  {
    id: 'level',
    short: '사용자 수준',
    title: '개발에 얼마나 익숙하세요?',
    why: '에이전트가 사용자에게 보여 주는 말과 화면의 자세한 정도가 달라집니다. 코드 검사 규칙은 같습니다.',
    options: [
      { id: 'A', label: '개발을 잘 모름', on: '쉬운 말과 그림 위주로 보여 주고, 고르는 안마다 무엇이 달라지는지 먼저 말함', gain: '용어·코드 없이 판단할 수 있다', cost: '함수 모양이나 테스트 위치 같은 세부는 기본으로 안 보인다' },
      { id: 'B', label: '개발자', on: 'A의 내용에 더해 함수 모양(signature)·테스트 위치(seam)·의존 방식까지 보여 줌', gain: '구현에 가까운 세부까지 보고 고른다', cost: '화면이 더 길고 기술 용어가 많다' },
    ],
  },
];

// Task-stage questions (asked in the chat, only when this work touches a risk area).
// The answer goes in the task card as `작업 질문 <risk>: A|B 사유`; A means the change
// really alters that behaviour, so "ADR 불필요" no longer counts for it.
const TASK_QUESTION_LINE = /^\s*(-\s*)?작업 질문 ([^\s:]+):\s*([AB])\b/gm;
const TASK_QUESTIONS = {
  auth: ['이 작업이 누가 무엇을 볼 수 있는지 바꾸나요?', '권한 변경 있음', '권한 변경 없음'],
  db: ['이 작업이 이미 쌓인 데이터를 바꾸거나 지우나요?', '기존 데이터 변경 있음', '추가만 (기존 데이터 그대로)'],
  external: ['이 작업이 외부 서비스로 보내는 데이터나 비용을 바꾸나요?', '전송·비용 변경 있음', '전송·비용 변경 없음'],
};
const taskQuestionOf = (risk) => TASK_QUESTIONS[risk] || [`이 작업이 ${risk} 영역의 동작을 바꾸나요?`, '동작 변경 있음', '동작 변경 없음'];

// { risk: 'A'|'B' } from the task card.
const taskAnswers = (card) => Object.fromEntries([...card.matchAll(TASK_QUESTION_LINE)].map((m) => [m[2], m[3]]));

// Questions this work still owes the person, one per touched risk area.
function pendingTaskQuestions(risks, card) {
  const done = taskAnswers(card);
  return risks.filter((r) => !done[r.risk]).map(({ risk, files }) => {
    const [q, a, b] = taskQuestionOf(risk);
    return `작업 질문(${risk}, ${files.slice(0, 2).join(', ')}): "${q}" A. ${a} (ADR 필수) / B. ${b} → 사용자에게 묻고 답을 작업 카드에 \`작업 질문 ${risk}: A 또는 B 사유\``;
  });
}

const readJson = (root, rel) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  } catch {
    return {};
  }
};
const has = (root, rel) => fs.existsSync(path.join(root, rel));

// Recommendation per question from what the repository shows: [optionId, reason].
function recommend(root) {
  const pkg = readJson(root, 'package.json');
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const any = (re) => deps.filter((d) => re.test(d));
  const auth = any(/^(express-session|passport|jsonwebtoken|next-auth|@auth\/|bcrypt|argon2|lucia)/);
  const db = any(/^(pg|mysql2?|sqlite3|better-sqlite3|prisma|@prisma\/client|knex|drizzle-orm|typeorm|sequelize|mongoose)$/);
  const ext = any(/^(@aws-sdk\/|aws-sdk|stripe|openai|@anthropic-ai\/|nodemailer|@sendgrid\/|axios|twilio|@google-cloud\/)/);
  const deployFiles = ['Dockerfile', 'docker-compose.yml', 'fly.toml', 'vercel.json', 'netlify.toml', 'Procfile', 'serverless.yml'].filter((f) => has(root, f));
  const migrations = ['migrations', 'db/migrations', 'prisma/migrations', 'supabase/migrations'].filter((d) => has(root, d));
  const list = (xs) => xs.slice(0, 3).join(', ');
  const login = auth.length ? ['A', `package.json에 ${list(auth)}`] : pkg.dependencies?.express ? ['A', 'express 서버가 있음 (로그인이 있는지는 추정)'] : ['B', '로그인 관련 패키지가 안 보임'];
  return {
    login,
    personal: login[0] === 'A' ? ['A', '로그인이 있으면 보통 이메일을 저장함 (추정) — 아니면 B'] : ['B', '로그인이 없어 보임'],
    db: migrations.length ? ['A', `폴더 있음: ${list(migrations)}`] : db.length ? ['A', `package.json에 ${list(db)}`] : ['B', 'DB 패키지·마이그레이션 폴더가 안 보임'],
    external: ext.length ? ['A', `package.json에 ${list(ext)}`] : ['B', '외부 서비스 패키지가 안 보임'],
    // Commit e-mails do not tell people apart (one person, several addresses).
    team: ['B', '커밋 기록으로는 알 수 없음 — 함께 개발하는 사람이 있으면 A'],
    reviewer: ['A', '추가 설치 없이 바로 쓸 수 있음'],
    level: ['A', '기본값: 비개발자 기준 (개발자면 B)'],
    deploy: deployFiles.length ? ['A', `배포 설정 있음: ${list(deployFiles)}`] : ['B', '배포 설정 파일이 안 보임'],
  };
}

// The answers in force: saved ones, the recommendation where a question was skipped.
// null until the first question session (nothing is required before anyone was asked).
function effectiveAnswers(root, config) {
  if (!config?.answers) return null;
  const rec = recommend(root);
  return Object.fromEntries(QUESTIONS.map((q) => [q.id, config.answers[q.id]?.choice || rec[q.id][0]]));
}

module.exports = { QUESTIONS, ALWAYS_ON, recommend, effectiveAnswers, pendingTaskQuestions, taskAnswers };
