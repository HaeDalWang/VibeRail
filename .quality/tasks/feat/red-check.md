# 실패할 수 없는 테스트 거르기 (R5)

## 의도
2026-11-24 grilling 결정(repo 밖 기록 ~/.local/share/intent/quality-harness/2026-11-24-backlog-decisions.md). 최종 검사(qh pr) 때 코드 변경을 되돌리고 테스트를 돌려, 그래도 통과하면 막는다.

## 원하는 결과
- 늘 통과하는 테스트는 qh pr에서 막힌다. seam이 있으면 seam마다 따로 본다.
- 새 파일만 바뀐 경우는 약한 증거로 통과, 테스트 불필요 면제는 건너뜀, 테스트 검사가 없으면 확인 못 함.
- 되돌리기 중 사람 작업 파일을 잃지 않는다.
- 결과가 완료 리뷰 화면에 보인다.

## 성공 조건 → 검사
- 늘 통과하는 테스트 막음 → "red check blocks always passing tests"
- 실제 변경 확인 통과 → "red check passes tests that fail on the base code"
- 새 파일만 약한 증거 → "red check reports weak evidence when all reverted files are new"
- 한 위치만 시험하면 막음 → "red check blocks an untested second seam"
- 테스트 불필요 면제 → "red check reuses the justified no-test waiver"
- 테스트 검사 없음 → "red check without a test command is inconclusive"
- 코드 없음 → "red check without changed code is inconclusive"
- 되돌리기 오류에도 파일 보존 → "red check cleans its clone and preserves files when restoring base code throws"
- 서비스 오류에도 파일·index 보존 → "red check preserves worktree and index even when the reversed run fails with a service error"
- 최종 검사에만 실행 → "red check does not run during check or Stop"
- 작업 테스트·의존성 연결 → "red check fills the work tests slot and links ignored dependencies"
- 시간 제한 준수 → "red check uses the test timeout and treats timeout as inconclusive"
- 기존 동작 유지 → npm test 전체

## 판단 필요
- [x] 이 범위로 진행할까요? · 예 (2026-11-24 결정 기록 확인: "ㅇㅇ 맞아 시작")

## 미확인
- 이 저장소에서 실제 최종 검사를 돌렸을 때 새 검사 줄과 완료 리뷰 표시: 쌓인 브랜치의 마지막 최종 검사 때 확인한다.

ADR 불필요: 사용자가 정한 동작을 기존 TDD 검사에 더하는 것이라 새 설계 결정이 아니다

## 검증 결과
- 코디네이터 재실행 npm test: 400개 전부 통과(exit 0). Codex sandbox의 EPERM 10개는 환경 문제였다.
- 임시 shared clone 사용: 원본 작업 파일과 index를 제자리 복원하지 않아 오류가 나도 원본을 잃지 않음. 의존 폴더 node_modules만 연결.
