# 백로그 작은 항목 (2026-11-24 결정분)

## 의도
2026-11-24 grilling에서 사용자가 정한 작은 항목을 만든다. 결정 기록: ~/.local/share/intent/quality-harness/2026-11-24-backlog-decisions.md (repo 밖).

## 원하는 결과
- R10: 에이전트가 쓴 면제 이유(테스트 불필요·문서 영향 없음·ADR 불필요)가 완료 리뷰 화면에 모여 보인다. 5자 기준은 그대로.
- 범위 확인: 카드 `## 판단 필요`에 범위 확인 답(`- [x] 이 범위로 진행할까요? · <답>`)이 없으면 카드 단계가 '의도'에 머문다.
- R16: 정적 웹앱의 저장소 맨 위 index.html은 루트 파일 경고 없이 허용된다.
- R8: 테스트 실행 명령이 없으면 qh init이 Node 내장 테스트(node --test)를 제안한다.

## 성공 조건 → 검사
- 면제 이유가 완료 리뷰 화면 글에 나옴 → test/review-page.test.js "review groups all declared waiver reasons in one escaped section"
- 범위 확인 답이 없으면 단계 '의도', 긍정 답이면 다음 단계 → test/cycle-policy.test.js "scope stays at intent until the exact question has a positive answer in decisions"
- 맨 위 index.html이 루트 파일 경고에 안 걸림 → test/structure.test.js "root index.html is allowed while other new root files still need a reason"
- 테스트 명령이 없을 때 init 안내에 node --test 제안 → test/init-detect.test.js "init suggests node --test for a Node project without configuring a test check"
- 기존 동작 유지 → npm test 전체

## 판단 필요
- 없음

## 미확인
- npm test는 373개 중 363개 통과, 10개 실패(exit 1). 로컬 서버 관련 기존 테스트가 sandbox에서 실패했으며 route-access 로그에 listen EPERM 127.0.0.1이 있다. /tmp/backlog-small-test.log
- node bin/qh.js check와 status는 git 임시 객체 작성 권한 오류(Operation not permitted)로 exit 3. /tmp/backlog-small-check.log, /tmp/backlog-small-status.log
- 실제 저장소 기록을 CLI로 만든 리뷰 화면 확인은 위 권한 오류로 미실시. 리뷰 페이지 회귀 테스트는 통과했다.
- 전체 통과와 환경 오류 없음 조건은 코디네이터가 권한 있는 환경에서 재검증해야 한다.

ADR 불필요: 사용자가 정한 방향을 작게 구현하는 것이라 새 설계 결정이 아니다

## 진행 계획과 증거
- 기존 면제 목록·긍정 답 판정을 재사용하고, 원본 skill과 기존 설명만 수정한다.
- RED: 네 회귀 테스트 모두 구현 전 실패, /tmp/backlog-small-red.log (exit 1, fail 4).
- GREEN: 해당 네 파일의 테스트 83개 통과, /tmp/backlog-small-green.log (exit 0).
- 전체 테스트: /tmp/backlog-small-test.log. 품질 검사: /tmp/backlog-small-check.log.
- 보호 설정·설치 사본·bin/qh.js는 변경하지 않으며 커밋·푸시는 하지 않는다.
- 최종 결과: 전체 테스트 exit 1(363/373 통과), check/status exit 3(환경 오류). 설정이나 검사 기준을 바꾸지 않았다.
