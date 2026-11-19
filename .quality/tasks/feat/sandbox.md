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

## 추가: 평가 중간·낮음 (2026-11-19)
- 9 허용 줄은 경로가 정확히 같을 때만 인정 → test/allow-line.test.js
- 10 qh answer로 생긴 기준 변경은 질문마다 한 항목, 바뀐 답을 말로 → test/criteria-answers.test.js
- 11 권한 질문은 한국어 수준 이름과 하는 일로 (`--labels`) → test/user-facing.test.js "a route question says what the route does…", test/route-access.test.js "routes --baseline --labels…"
- 12 ADR 0001에 출처와 Karpathy 줄(2차 출처), 범위에서 implement 제거 → test/docs-facts.test.js "the ADR says where…"
- 13 README에 먼저 묻고 설계안을 보여 주는 흐름은 Claude Code만 → test/docs-facts.test.js "the README says…"
- 14 화면은 사용자 대신 열고 doctor 실패는 한 문장으로 → test/user-facing.test.js "pages are opened for the person…"
- 15 결과지에서 저장한 버전 번호 제거, 실행 뒤 글도 검사 → test/user-words.test.js "the measure report text drawn at runtime…"
- 16 문서가 판정한다고 쓴 곳 바로잡고 빠진 명령 행 추가 → test/docs-facts.test.js "reference.md lists every command…", "the docs do not say the report judges…"
- 17 외부 연동 선택지: 외부망 차단은 내장 검사만 → test/user-facing.test.js "the external-integration option…"
- 18 TDD·문서 규칙은 의도의 증거이지 옳은지의 증거는 아니라고 문서화 → test/docs-facts.test.js "the docs say the TDD and docs rules…"
- 19 같은 항목 연속 차단 횟수를 limits.sameBlocks로, 근거 기록 → test/stop-limits.test.js, test/docs-facts.test.js "reference.md has a row…"
- 20 init이 지도 설정을 ignore 목록에 넣고 코드 지도가 더하는 것을 알림, INSTALL의 .mcp.json 커밋 지시 삭제 → test/init-gitignore.test.js
- 21 결과지와 큰 파일 검사가 같은 줄 수 계산 → test/line-count.test.js
- 22 Stop 기록은 AI를 돌려보낸 때만, 종류는 한 번씩, 분류 바로잡음 → test/stop-log.test.js
- 23 커밋 없는 저장소의 qh measure → test/measure-nocommit.test.js
- 24 사용자에게 보이는 말에서 에이전트 대신 AI → test/hook-flow.test.js, test/user-words.test.js "the probe question…"
- 25 qh answer도 사유 최소 길이 → test/criteria-answers.test.js "qh answer refuses a reason shorter…"
- 26 MIN_REASON_CHARS 삭제, 부르는 곳 없는 export 정리, esc 한 곳 → 전체 테스트(삭제 확인은 grep)
- 27 doctor 메시지를 질문 화면의 선택지 이름으로 → test/doctor-labels.test.js "every answer label…"
- 28 고정 숫자 행 추가, 안내 문구의 6줄·5자를 limits에서 → test/docs-facts.test.js, test/init-skills.test.js "the installed agent rules…"
- 30 init이 결과지·측정 기록을 ignore 목록에 → test/init-gitignore.test.js
- 32 qh pr 통과 줄에 열린 AI 지목·기준 변경 건수 → test/pr-gate.test.js "the pr pass line…"
- 33 협업 CI 검사는 qh.js를 부르는 run 단계만 인정 → test/doctor-labels.test.js "the team CI check…"
- 건너뜀: 29(기본 리뷰 명령의 개인 도구·모델 이름), 31(stop-state 동시 쓰기 잠금)
- [x] 11 · 등급 한국어 이름 + 하는 일로 설명 (사용자 선택 2026-11-19)
- [x] 12 · 출처 적고 원칙 인용 (사용자 선택 2026-11-19)
- [x] 13 · README에 Claude Code만 명시 (사용자 선택 2026-11-19)
- [x] 17 · 선택지 문구를 내장 검사만으로 (사용자 선택 2026-11-19)
- 미확인: README의 결과지 캡처(report.png)에는 옛 버전 번호가 남아 있다. 다시 찍어야 한다.

## 추가: 2차 수정분 새 눈 검토 지적 (2026-11-19)
- review.cmd 자리표시가 따옴표 안에서 다른 글과 붙으면 경로가 깨짐 → 셸 따옴표 상태를 따라가며 채움 → test/shell-words.test.js
- 분리된 HEAD에서 qh pr 통과가 기준점을 기록함 → 브랜치 위에서만 기록 → test/base-commit.test.js "a qh pr pass on a detached HEAD records no anchor"
- 비밀값 면제 답이 개수만 같으면 바뀐 값도 덮음 → 질문에 표시된 값으로 만든 확인 번호 → test/waivers.test.js "...asked about first..."
- 결정 로그의 기준점 기록 조건 문구를 실제 동작(qh pr 통과만)에 맞춤
- 미확인: CI에서 기준이 얕은 clone이면 기준 확인 질문 문장이 로컬과 달라질 수 있음(추정, 재현 안 함).

## 추가: 평가 중간·낮음 수정분 새 눈 검토 지적 (2026-11-19)
- 서로 다른 주소가 같은 질문 문장이 되어 한 질문으로 합쳐짐 → 겹치면 주소를 괄호로 붙임 → test/user-facing.test.js "two routes that would read the same..."
- 로그인 주소가 "로그인 새로 만들기"로 읽힘 → 로그인·로그아웃·가입·검색은 "하기" → 같은 테스트
- 허용 줄에 경로 여럿(쉼표)을 쓰면 모두 안 맞음 → 쉼표로 나눠 각각 정확히 비교 → test/allow-line.test.js "several paths"
- 그대로 둠: 모르는 주소는 괄호 안 주소로(의도한 대체), uninstall이 사용자가 직접 넣은 같은 무시 줄도 지움, 새 clone에서 코드 지도 경고(init 다시 실행 안내), CI 검사 판독의 YAML 경계 사례, doctor 실패 문장 번역은 안내 규칙에만 기댐, AGENTS 블록의 사유 글자 수는 init 때 채움.
