# 체험용 가짜 프로젝트 스크립트

## 원하는 결과
사람이 바이브코더 역할로 가짜 할 일 목록 웹앱에서 순환(의도 → … → 회고)을 직접 한 바퀴 돌며 질문·선택지를 체감할 수 있다. 매번 같은 출발점에서 다시 시작할 수 있다.

## 성공 조건 → 검사
- 스크립트 한 번으로 VibeRail이 설치·커밋된 깨끗한 가짜 프로젝트가 생김 → scripts/sandbox.sh 실행 exit 0, 커밋 2개, 미커밋 0개 (수동 확인)
- 다시 돌리면 같은 출발점으로 새로 만듦 → 재실행 exit 0 (수동 확인)
- 스크립트가 만들지 않은 폴더는 지우지 않음 → 다른 폴더 지정 시 멈춤 exit 1 (수동 확인)

## 판단 필요
- [x] 가짜 프로젝트 종류 · 할 일 목록 웹앱
- [x] 한 번 체험 vs 다시 돌릴 세트 · 다시 돌릴 수 있는 세트
- [x] 체험 기록 방식 · 에이전트가 단계마다 메모

## 미확인
- 실제 한 바퀴 체험은 사용자가 아직 안 함.

테스트 불필요: 개발자용 체험 스크립트, 실행 결과로 세 조건을 직접 확인함
문서 영향 없음: 개발 전용 도구라 공개 문서가 아니라 CLAUDE.local.md에 한 줄
ADR 불필요: 제품 동작·구조 변경 없음, 저장소 밖 임시 폴더만 만듦

## 추가: 선택지를 선택 창으로
- 체험 중 사용자 요청: 선택지 질문을 텍스트가 아니라 방향키로 고르는 창으로 → 규칙 블록에 한 줄(Claude Code는 AskUserQuestion, 없거나 5개 이상이면 번호 텍스트) → test/user-facing.test.js "the agent rules ask choices with the arrow-key picker..."
- 작업 질문 안내의 "채팅에서"를 뺌(새 규칙과 충돌)
- [x] 선택지 표시 방식 · 선택 창으로 (사용자 요청)

## 추가: 체험 막힘 고치기 (2026-11-18 루프)
- 에이전트가 이미 물은 카드 질문을 Stop 훅이 다시 묻게 해서 질문이 두 번 나옴 → 마지막 답에 물음표나 "주세요"가 있으면 카드 질문은 되돌리지 않음 → test/stop-hook.test.js "a decision the agent already asked about..."
- "켜진 검사: 없음"이 무슨 뜻인지 모름 → "아직 켜 둔 자동 검사가 없음" → test/user-facing.test.js
- interface 화면 JSON 모양을 몰라 qh 코드를 뒤짐 → qh-cycle 스킬에 모양 한 줄 → test/init-skills.test.js
- 범위를 grilling과 ◆①에서 두 번 물음 → 이미 같은 범위에 예라고 했으면 기록만 (스킬 한 줄, 문구라 테스트 불필요 범위)
- reference.md의 Mermaid 설명이 지금 동작(로컬 사본으로 그림)과 달라 맞춤
- interface 화면 복사가 무거워 사용자가 채팅으로 바로 답함 → 화면·에이전트 안내에 "말로 해도 된다" → test/view.test.js
- 훅이 카드 줄을 그대로 보여 사람 말이 아님 → 규칙: 판단 필요 항목은 사용자가 그대로 읽고 답할 수 있는 질문 한 줄로 → test/user-facing.test.js
- 에이전트가 테스트 검사 넣는 법을 몰라 qh 코드를 뒤짐 → 설치되는 질문 안내에 "검사 넣기"(묻고, 예면 checks에 test/test-work) → test/user-facing.test.js
- README 설계안 캡처를 바뀐 화면으로 다시 찍고, 말로 답해도 된다는 한 줄 추가
- 카드 질문이 질문 문장이면 "정해 주세요:"를 붙이지 않고 그대로 보임(이중으로 묻지 않게) → test/user-words.test.js

## 추가: 새 눈 평가 HIGH 8건 고치기 (2026-11-18)
- 1 기준 브랜치에서 커밋한 작업이 안 보임 → 마지막 통과 커밋(없으면 설정을 넣은 커밋)과 비교 → test/base-commit.test.js
- 2 `qh status --pr`이 막힐 때 0으로 끝남 → 막히면 1, CI는 `check --pr` 다음 `status --pr` → test/pr-gate.test.js "status --pr exits non-zero..."
- 3 에이전트가 사람 결정 면제를 글만으로 씀 → grilling 불필요·qh confirm·비밀값 허용 표시는 사용자에게 보인 뒤에만 인정 → test/waivers.test.js
- 4 검토 생략(C)에서 `qh pr`이 exit 3 → 검토 건너뜀 → test/pr-gate.test.js "pr skips the review..."
- 5 review.cmd 자리표시가 따옴표 없이 들어감 → 셋 다 따옴표 처리 → test/pr-gate.test.js "review.cmd placeholders are shell-quoted..."
- 6 지우기(git revert)가 설치 뒤 충돌 → `qh uninstall` → test/uninstall.test.js
- 7 아키텍처 점검 화면이 CDN·영어 → `qh view architecture <json>` → test/view.test.js
- 8 README의 "코드는 밖으로 나가지 않습니다" 과장 → 문구 교체 → grep으로 옛 문구 0건
- [x] 1 비교 기준 · 마지막 통과 커밋, 없으면 설정을 넣은 커밋 (사용자 선택 2026-11-18)
- [x] 3 면제 범위 · 사람 결정을 건너뛰는 셋만 사용자에게 보인 뒤에 인정 (사용자 선택 2026-11-18)
- [x] 7 아키텍처 화면 · `qh view architecture` 로컬 한국어 (사용자 선택 2026-11-18)
- 미확인: 새 눈 평가가 다시 돌아 8건이 풀렸는지는 아직 안 봄.

## 추가: 새 눈 재평가 HIGH 고치기 (2026-11-18)
- 통과 기록(기준점)은 PR 단계 통과에서만 → test/base-commit.test.js; 분리된 HEAD는 기준점 없음 → 같은 파일
- 사람 결정 면제 셋(grilling 불필요·qh confirm·비밀값 허용)은 카드 `## 판단 필요`의 `- [x] <질문 그대로> · <답>` 줄로만 인정, CI 재현 포함 → test/waivers.test.js
- qh:allow-pii를 qh pr 면제 목록에 나열, 안내 문구 끝 공백 제거 → test/waivers.test.js
- uninstall: 바뀐 스킬 폴더는 남김, 설정 파일 검증 뒤에만 씀 → test/uninstall.test.js
- review.cmd에 이미 따옴표가 있는 자리표시, 검토 생략 안내 한 줄, 겹치는 id 거절 → test/pr-gate.test.js·test/view.test.js
- [x] 면제 확인 방식 · 카드의 `- [x] 질문 · 답` 줄로 옮김 (조정자 결정 2026-11-18, 다른 사람 결정과 같은 방식)
- 미확인: 파일 줄은 사람이 답했다는 증명이 못 된다. 다른 판단 필요 항목과 같은 신뢰 수준.
