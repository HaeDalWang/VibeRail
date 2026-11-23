# 설계안 화면에 질문 칸

## 의도
interface·아키텍처 점검 화면에서 사람이 안을 고를 때, 그 결정에 딸린 질문(선택지 + 추천)을 안 바로 옆에서 함께 답하게 한다. 답은 고른 안·이유와 함께 복사되고, 카드 `## 판단 필요`의 `- [x] 질문 · 답` 줄로 남는다(백로그 1번, plannotator question-block 본뜸).

범위(grilling 답, 2026-11-23):
- 질문 위치: 안마다 + 화면 공통 둘 다
- 질문 형태: 하나 고르기 + 추천 표시 + 기타(자유 입력). 여러 개 고르기는 뺌
- 답 기록: 복사 줄에 `- [x] 질문 · 답`으로 함께 → AI가 카드에 그대로 적음. 질문 글이 바뀌면 옛 줄과 맞지 않아 다시 묻게 됨
- 적용 화면: interface와 아키텍처 점검 둘 다
- 미답: 고른 안의 질문 + 공통 질문에 답이 없으면 복사를 막고 빠진 질문을 알림. 다른 안의 질문은 무시
- 브랜치: feat/sandbox 위에 새 브랜치(feat/sandbox PR이 먼저 합쳐져야 함)

## 용어

## interface 결정
안: A (안 안에 넣기 — 공통 질문은 맨 위 questions, 특정 안의 질문은 그 안의 questions)
이유: 단순한 구조가 추후 문제를 찾기가 쉽다

## 테스트 위치(seam)
test/view.test.js

명세: .scratch/view-questions/spec.md

작업: .scratch/view-questions/issues/ (01 공통 질문 → 02 안마다 질문 → 03 아키텍처 화면)

## 루프
.scratch/view-questions/issues/01-common-questions.md
.scratch/view-questions/issues/02-option-questions.md
.scratch/view-questions/issues/03-architecture-questions.md

## 성공 조건 → 검사
- 공통 질문이 화면 맨 위에 한 번, 추천 표시·기타 칸과 함께 보임 → test/view.test.js "common questions show once above the options…"
- 복사에 `- [x] 질문 · 답` 줄, 빠진 질문은 이름을 대고 막음 → "the copy carries one card-ready line…"
- 잘못 적힌 질문은 화면을 만들지 않고 고칠 점을 말함 → "a malformed question writes no page…"
- 안마다 질문은 그 안 카드 안에만, 고른 안의 질문만 필수 → "an option's questions show inside that option's card only…"
- 같은 범위 안 중복 질문 거절, 다른 안끼리는 허용 → "the same question in the common list and an option is rejected…"
- 아키텍처 점검 화면도 같음 → "the architecture page shows common and per-candidate questions…"
- 순환 안내에 JSON 모양 → test/init-skills.test.js "qh-cycle tells the agent the optional questions shape…"
- 질문 없는 화면은 그대로 → 기존 view 테스트 전부 통과
- 클릭 흐름(미답 막기·다른 안 질문 무시·기타 한 줄) → test/view.test.js "clicking a pick…" (test/mini-dom.js로 화면 스크립트 실행, 일부러 망가뜨린 두 경우를 잡는 것 확인)

## 판단 필요
- [x] 설계안 화면에 질문을 어디에 둘까요? · 안마다 + 화면 공통
- [x] 질문 형태는 어디까지 지원할까요? · 하나 고르기 + 추천 표시
- [x] 화면에서 고른 답은 어떻게 기록할까요? · 복사 줄에 함께 → 카드 [x] 줄
- [x] 작업 브랜치는? · 지금 브랜치 위에 새 브랜치
- [x] 아키텍처 점검 화면에도 같은 질문 칸을 넣을까요? · 둘 다
- [x] 질문에 답하지 않고 복사를 누르면? · 막고 빠진 질문 알려줌

## 미확인
- mini-dom은 qh view가 쓰는 HTML만 읽는다. 실제 브라우저와 다른 점(라디오 하나만 체크 등)은 손 확인(playwright, 2026-11-23)으로만 봄.

ADR 불필요: 화면 JSON에 선택 항목 하나 추가, 구조 변경 없음

## 회고 (2026-11-23)
- [x] 회고에서 나온 개선 후보 중 어느 것을 적용할까요? · 1. 화면 클릭 흐름 자동 테스트, 2. 개발 중 화면은 작업본으로
- 1 → test/mini-dom.js + view 클릭 흐름 테스트, 코드 글자를 찾던 테스트 줄 삭제
- 2 → CLAUDE.local.md 한 줄(로컬 전용)
- 3 커밋마다 코드 지도 출력 줄이기: 사용자가 고르지 않음
