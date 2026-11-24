# 단독 작업이면 PR 생략, 최종 검사 때 지표 자동 기록 (R13·R14)

## 의도
2026-11-24 사용자가 확정한 R13·R14 결정. 단독 작업이면 PR 열기만 생략(최종 검사·완료 리뷰는 유지). 시범 지표가 멈추지 않게 최종 검사 통과 때 자동으로 쌓는다.

## 원하는 결과
- 프로젝트 질문 team이 단독 작업이면 qh pr 통과 문구가 PR 없이 기준 브랜치에 합쳐도 된다고 말하고, 에이전트 규칙도 같다.
- qh pr이 통과하면 지표 한 줄이 쌓이고 결과지가 만들어진다. VIBERAIL_METRICS_DIR가 있으면 거기로 복사한다.
- 결과지에 ADR 0001 다시 볼 조건 지표(이유 공란·5자 미만 비율, 같은 종류 막힘 횟수)가 보인다.

## 성공 조건 → 검사
- team 단독/팀 문구 → `pr pass guidance uses the existing team answer A` / `B`
- 통과 때만 지표 증가 → `pr appends one metrics row on each pass and none when blocked`
- 측정·복사 실패해도 exit 유지 → `pr keeps its passing exit code when measurement or copying fails`
- 복사 폴더 지정/미지정 → `pr copies metrics and the generated report only when an export folder is set`
- 결과지 보조 지표 → `report shows short interface reasons share and repeated blocks by kind as reference metrics`
- 기존 동작 유지 → npm test 전체

## 판단 필요
- 없음

## 미확인
- 전체 테스트 exit 0: 이 실행 환경은 로컬 서버 열기를 거부한다. 변경 전 코드에서도 네트워크 관련 10건이 동일하게 실패했다.
- 설치된 품질 검사 상태: 작업 상태 기록 중 Git 객체 저장이 실행 환경의 쓰기 제한으로 실패한다. 설정·설치 사본을 바꾸지 않았다.

ADR 불필요: 사용자가 정한 방향을 구현하는 것이고 ADR 0001의 사람 확인 지점은 바뀌지 않는다

## 구현 계획
- 기존 team 답으로 통과 안내만 나눈다.
- 통과 후 기존 측정을 부르고, 지정된 폴더로 복사한다. 실패는 경고만 남긴다.
- interface 결정이 있는 카드의 이유 누락 비율과 기존 종류별 막힘을 참고 지표로 보여 준다.
- 실패 테스트 → 최소 구현 → 전체 테스트와 설치된 품질 검사 순서로 확인한다.

## 테스트 위치(seam)
- test/pr-gate.test.js
- test/measure-page.test.js

## 검증 기록
- 실패 테스트: /tmp/solo-metrics-red.log, 삭제된 카드 사례 /tmp/solo-metrics-deleted-red.log.
- 전체 테스트: /tmp/solo-metrics-test.log. 변경 전 네트워크 검사 비교: /tmp/solo-metrics-baseline-test.log.
- 실제 기록으로 결과지 생성 후 화면 스크립트를 실행해 글을 확인: 이유 누락 20%, 종류별 막힘 표 표시.
- bin/qh.js 797줄. 금지된 설정·설치 사본·AGENTS.md 변경 없음.
- Build·type·lint: 별도 실행 명령 없음. 변경 diff 공백·비밀값·개인 경로 검사 이상 없음.
- commit·push 없음.
