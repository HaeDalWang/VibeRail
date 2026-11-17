# 전면 검토 후속 수정

## 의도
전면 검토에서 나온 0순위·1순위 위반과 근거 없는 판정을 고친다. 상세: ~/.local/share/intent/quality-harness/2026-11-17-full-review-fixes.md

## 원하는 결과
기존 중복은 막지 않고, 사용자는 명령을 치지 않고, 결과지는 근거 있는 것만 판정하고, 화면은 그림이며, Claude만 쓰는 사용자도 AI 리뷰가 붙는다.

## 성공 조건 → 검사
- 설정에 duplicates가 없어도 기존 중복은 경고만 → test/structure.test.js
- qh-cycle 안내에 사용자가 치는 슬래시 명령이 없음 → test/user-facing.test.js
- 결과지에 건수 비교 결론·개선/악화 판정이 없음 → test 결과지 테스트
- 고정값 근거 또는 기본값 표시 → docs/reference.md, 관련 테스트
- interface 화면이 로컬 Mermaid로 그림을 그림(외부 요청 없음) → test/view.test.js
- kiro-run 없이 claude만 있으면 review.cmd 채움 → test/init-detect.test.js
- `## 의도`로 끝나는 카드도 의도 검사 → test/card.test.js
- README 캡처가 현재 화면 → 시험 프로젝트 캡처
- 기존 동작 유지 → npm test 전체

## 판단 필요
- [x] 명령 입력 단계 처리 · AI가 대신 불러 줌
- [x] 결과지 판정 · 건수 비교 결론 삭제
- [x] 고정값 · 근거 찾고 없으면 기본값 표시
- [x] 바로 고칠 5건 · 모두 고치기

## 미확인
- Mermaid 로컬 사본 크기.
