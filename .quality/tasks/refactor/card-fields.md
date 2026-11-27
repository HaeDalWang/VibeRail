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

## 판단 필요
- [x] 명세 연결 줄('명세: 파일')을 카드의 어디에서 찾을까요? · 설계 결정 칸 안만
- [x] '안:'·'이유:'·'설계안:'·'명세:' 줄의 모양을 어디까지 받을까요? · 너그럽게 통일
- [x] 새 테스트는 카드 모듈 테스트 한 곳에만 쓰고, 옮겨지는 다른 곳들은 기존 테스트가 그대로 통과하는지로 확인할까요? · 카드 모듈 한 곳
- [x] 명세 대조가 카드를 비교할 때 '판단 필요'·'루프' 칸을 빼는 부분도 이번에 카드 모듈로 옮길까요? · 이번에 옮김
- [x] 이 범위로 진행할까요? · 진행

## 미확인
- 명세 줄을 칸 밖에 적으면 시작 확인이 빠지는지: 재현 전
