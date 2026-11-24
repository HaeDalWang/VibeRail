# 지표를 실제로 실행된 코드 기준으로 세기 (R9)

## 의도
2026-11-24 grilling 결정(repo 밖 기록 ~/.local/share/intent/quality-harness/2026-11-24-backlog-decisions.md). "테스트가 안 붙은 코드 파일 %"를 이름이 같은 테스트 대신 테스트 중 실제 실행된 코드로 센다. 중복 지표가 한 줄짜리 중복을 못 본다는 점을 결과지에 밝힌다.

## 원하는 결과
- seam만 테스트해도 간접 실행되는 내부 파일은 "붙음"으로 센다.
- 잴 수 없는 경우(테스트 명령 없음, Node 아님, 커버리지 없음, 과거 커밋 backfill)는 숫자 대신 "잴 수 없음".
- 같은 코드 상태의 커버리지가 있으면 테스트를 다시 돌리지 않는다.
- 중복 비율 설명에 세는 범위가 보인다.

## 성공 조건 → 검사
- 간접 실행/미실행/최상위 실행 구분 → coverage counts indirect function execution, not module loading
- 명령 없음/비Node/빈 기록/과거 → coverage is unavailable without usable Node test execution
- 같은 트리 재사용 및 변경 무효화 → coverage reuses full check evidence only for the same tree
- 셸 스크립트 등 Node가 실행하지 않는 파일은 분모에서 뺌 → coverage counts indirect function execution, not module loading
- 실제 저장소 측정 → 0%(이전 규칙 57.6%, 규칙 5라 직접 비교 안 함)
- 전체 회귀 → /tmp/coverage-test.log

## 판단 필요
- [x] 이 범위로 진행할까요? · 예 (2026-11-24 결정 기록 확인: "ㅇㅇ 맞아 시작")

## 미확인
- 없음

## 구현 계획
- 기존 전체 테스트 검사와 트리 해시를 공유해 함수 실행 기록을 남긴다.
- 측정과 결과지, 소급 행, 문서의 의미를 함께 바꾼다.
- 실패 테스트 → 구현 → 전체 회귀 및 실제 측정 순서로 확인한다.

ADR 불필요: 기존 측정 경로에 승인된 실행 기준을 적용하며 구조 선택은 바꾸지 않는다.

## 검증 기록
- RED: /tmp/coverage-red.log (기존 같은 이름 판정은 간접 실행 33.3% 조건에 실패).
- 핵심 동작 및 결과지: /tmp/coverage-targeted.log, 실패한 테스트 실행도 범위 집계 / 깨진 기록은 측정 불가 / 도구 선택 항목 포함.
- 전체 검사: /tmp/coverage-test.log. 환경 실패는 기존 HTTP 서버 시작 권한이며 허용 줄이나 검사 설정을 추가하지 않음.
- 결정 로그와 사용자 설명 갱신. 새 의존성 없음, 사본과 금지 설정은 변경하지 않음.
- 코디네이터: npm test 409개 전부 통과(exit 0). 셸 스크립트를 세던 5.7%를 고쳐 이 저장소 0%.
