# 작업 카드의 나머지 칸 읽기도 카드 모듈 한 곳으로

## 의도
작업 카드의 `## interface 결정`(안·이유·설계안·명세)과 `## 성공 조건 → 검사`·`## 미확인` 칸을 여러 곳이 각자 읽는다. 이것을 카드 모듈(lib/card.js)로 모아 어긋남을 없앤다(아키텍처 점검 2026-11-27, 사용자: "위험이 낮은 변경들이므로").

확인한 어긋남(코드 읽음, 2026-11-27):
- 명세 줄: spec-check `specOf`와 qh.js runReview는 카드 전체에서 줄 맨 앞 `명세:`를 찾고, confirm `specConfirm`은 `## interface 결정` 칸 안에서만 찾는다(들여쓰기 허용). 칸 밖에 적으면 명세 대조는 찾고 시작 확인은 못 찾는다(추정, 첫 테스트로 재현)
- 안·이유 줄: cycle.js·policy.js는 `declaredReason`으로 `- 이유:`·`**이유**:`·전각 콜론도 읽고, confirm `pickedOption`·review-page `pickedStep`은 줄 맨 앞 `안:`/`이유:`만 읽는다
- `cardLines`가 confirm.js·review-page.js에 복사돼 있다
- `성공 조건 → 검사`·`미확인` 칸 이름이 review-page에 글자로 박혀 있다(SECTIONS에 없음)

범위(grilling 답, 2026-11-27):
- 카드 모듈이 `## interface 결정`의 안(+확인 번호)·이유·설계안·명세, `## 성공 조건 → 검사`·`## 미확인` 칸 줄, 명세 대조용 "판단 필요·루프 칸을 뺀 카드"를 돌려준다
- 명세 줄은 `## interface 결정` 칸 안에서만 찾는다(명세 대조·AI 리뷰 시작도 같게)
- 줄 모양은 너그럽게 하나로: 목록 표시(`-`·`*`·`+`), 굵게(`**`), 백틱, 들여쓰기, 전각 콜론 모두 같은 줄. 바뀌는 동작마다 테스트 먼저
- 옮기는 곳: confirm(cardLines·lineAfter·pickedOption·specConfirm), spec-check(specOf·checkedCard), qh.js runReview, review-page(cardLines·pickedStep·evidenceStep·leftStep), cycle.js·policy.js의 `이유` 판정
- 명세 대조 확인 번호는 지금 카드에서 같은 값이 나와야 한다(이미 통과한 기록이 다시 묻지 않게)
- 넣지 않음: 작업 파일 경로 읽기(ticketPaths, 카드 전체에서 찾음), 구조 점검 2~4번 후보
- 브랜치: main에서 새로

## 용어

## interface 결정
안: A (칸별로 묻는 함수 세 개 추가 — lib/card.js pick(card)·items(card, name)·without(card, names)) · 확인 번호 0056
이유: 읽는 장소가 한곳이므로
설계안: .scratch/card-fields/interface.json
명세: .scratch/card-fields/spec.md
작업: .scratch/card-fields/issues/01-pick-and-spec-link.md, .scratch/card-fields/issues/02-picked-option-everywhere.md, .scratch/card-fields/issues/03-card-without-sections.md

## 테스트 위치(seam)
test/card.test.js

## 루프
.scratch/card-fields/issues/02-picked-option-everywhere.md

## 성공 조건 → 검사
- 칸 밖 명세 줄은 명세 없음 → test/card.test.js "a 명세 line outside the interface section is no spec"
- 안 줄에서 id·확인 번호·전체 값 → test/card.test.js "the 안 line gives its id, confirmation number and whole value"
- 여러 모양의 줄을 같게 읽음 → test/card.test.js "field lines are read in common markdown shapes"
- 경로의 백틱 제거 → test/card.test.js "backticks around the 설계안 and 명세 paths are removed"
- 없는 칸·줄은 null → test/card.test.js "a missing section or field is null"
- 이름 준 칸만 빼고 나머지는 그대로 → test/card.test.js "without removes exactly the named sections and leaves the rest unchanged"
- 실제 카드 모두에서 옛 자르기와 같은 결과 → test/card.test.js "without matches the old spec check cutter on every real task card"
- 칸의 목록 줄을 표시 빼고 돌려줌 → test/card.test.js "items gives the list lines of a section without markers, at any indentation"
- 미확인 칸은 목록 표시 없는 줄도 보여 줌 → test/card.test.js "lines gives every non-empty line of a section, list markers removed"
- 성공 조건·미확인 칸 이름이 카드 모듈에 → test/card.test.js "the section names include success conditions and unconfirmed"

## 판단 필요
- [x] 명세 연결 줄('명세: 파일')을 카드의 어디에서 찾을까요? · 설계 결정 칸 안만
- [x] '안:'·'이유:'·'설계안:'·'명세:' 줄의 모양을 어디까지 받을까요? · 너그럽게 통일
- [x] 새 테스트는 카드 모듈 테스트 한 곳에만 쓰고, 옮겨지는 다른 곳들은 기존 테스트가 그대로 통과하는지로 확인할까요? · 카드 모듈 한 곳
- [x] 명세 대조가 카드를 비교할 때 '판단 필요'·'루프' 칸을 빼는 부분도 이번에 카드 모듈로 옮길까요? · 이번에 옮김
- [x] 이 범위로 진행할까요? · 진행
- [x] 명세에 '인용·번호 목록·체크박스 줄도 받기'가 들어갔습니다. 원하신 건가요? · 네, 원함
- [x] 명세(확인 번호 2714)대로 작업을 시작할까요? · 돌려
- [x] 명세 대조용 카드를 만들 때 '판단 필요 메모'처럼 이름이 이어지는 칸도 뺄까요, 제목이 정확히 같은 칸만 뺄까요? · 정확한 제목만
- [x] 남은 작업 하나(확인 번호·완료 리뷰 화면·순서 안내도 고른 안 읽기로)를 다음 루프로 돌릴까요? · 다음 루프로
- [x] 명세가 확인한 뒤 바뀌었습니다(확인 번호 2714 → 5204). 바뀐 명세대로 계속할까요? · 계속
- [x] 명세가 확인한 뒤 바뀌었습니다(확인 번호 2714 → 5204). 바뀐 명세대로 계속할까요? · 돌려
- [x] 같은 칸(예: 이유)에 비어 있는 줄이 먼저 있고 뒤에 값이 있는 줄이 있으면, 빈 줄을 건너뛰고 값이 있는 줄을 읽을까요? · 그대로 둠(첫 줄이 이김)
- [x] On the completion review page, should sentences written under '미확인' without a list mark (-) still show? (They used to show; after this change only lines with the mark appear.) · 표시 없어도 보여줌
- [x] 작업 세 개가 모두 끝났습니다. 이 카드를 여기서 끝낼까요? · 끝냄

## 미확인
- 명세 줄을 칸 밖에 적으면 시작 확인이 빠지는지: 옛 코드로 직접 재현하지 않음(바꾼 뒤에는 세 곳 모두 '명세 없음'으로 봄, 테스트와 안내 글로 확인)
