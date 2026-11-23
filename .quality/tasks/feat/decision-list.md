# 작업 카드 판단 필요 질문 목록 읽기를 한곳으로

## 의도
작업 카드 `## 판단 필요` 칸을 읽는 곳이 다섯 군데에 흩어져 서로 다르게 읽는다. 이것을 한 곳으로 모아 어긋남을 없앤다(아키텍처 점검 2026-11-23, 사용자: "어긋나는 걸 줄이는 게 제일 급하다").

확인한 어긋남(시험 카드로 돌려 봄):
- 들여쓴 `- [ ] 질문`: 면제 질문은 열린 질문으로 보고, PR 막기(taskDecisions)는 못 봐서 PR이 통과된다
- `- [X] 질문 · 답`: 형식 검사는 체크 줄로 통과, 답 판정(answerState)은 소문자 x만 인정 → 같은 질문이 계속 다시 뜬다
- 칸 제목: card.js section은 정확히 `판단 필요`·주석 제거, qh.js decisionSection은 `판단 필요`로 시작하는 아무 제목·주석 포함
- `* [ ]`·`+ [ ]`: 형식 검사는 통과, PR 막기와 면제 질문은 못 본다

범위(grilling 답, 2026-11-23):
- 읽는 곳 다섯: confirm(cardLines·approvedNumbers), review-page(cardLines·leftStep), waivers(answerState), qh.js(decisionSection·taskDecisions·cardFormatProblems)
- 규칙은 너그러운 쪽 하나로: 들여쓴 줄도 읽고, `[x]`·`[X]` 둘 다 답, `-`·`*`·`+` 목록 표시 모두, 칸은 제목이 정확히 `판단 필요`인 것만 읽고 주석은 뺀다. 바뀌는 동작마다 테스트 먼저
- 넣지 않음: 구조 점검 2번 후보(의도 판정 중복), 안내 글(`- [x] 질문 · 답`으로 적으라는 문장) 모으기, 답 없는 체크 줄 안내
- 브랜치: feat/confirm-number 위에 새로

## 용어

## interface 결정
안: B (질문과 답까지 읽어 주는 모듈 — lib/card.js decisions(card)·answerState(card, question)) · 확인 번호 9954
이유: 어긋남을 줄이는것이 크다
설계안: .scratch/decision-list/interface.json
명세: .scratch/decision-list/spec.md

## 테스트 위치(seam)
test/card.test.js

## 루프

## 성공 조건 → 검사
- 들여쓴 `- [ ] 질문`도 열린 질문이다 → test/card.test.js "indented checkbox lines are read"
- `[X]`도 답한 줄이다 → test/card.test.js "upper-case X counts as answered"
- `*`·`+` 목록 표시도 같게 읽는다 → test/card.test.js "star and plus markers are read like dashes"
- 제목이 정확히 `판단 필요`인 칸만, 주석 속 질문은 뺀다 → test/card.test.js "only the exact heading is read, comments dropped"
- 체크 없는 맨 앞 줄만 형식 문제, 들여쓴 설명·없음은 아니다 → test/card.test.js "plain items are top-level non-checkbox lines"
- 답 판정 yes/open/none, 답 없는 체크 줄은 none → test/card.test.js "answerState needs a non-empty answer"
- 다섯 곳은 이 모듈만 부르고 기존 테스트가 그대로 통과한다 → npm test

## 판단 필요
- [x] 한곳으로 모을 때 어긋나는 세 군데(들여쓴 질문, 대문자 X, 칸 제목 판정)를 어떻게 할까요? 하나로 모으면 어느 한쪽 규칙으로 맞춰야 해서, 보이는 동작이 조금 바뀝니다. · 너그러운 쪽으로 통일
- [x] 구조 점검 2번 후보(코드가 바뀌었을 때 '의도' 칸이 비었는지 판정하는 코드가 두 곳에 중복)도 이번 작업에 넣을까요? · 넣지 않음
- [x] 화면이나 안내 문구에 들어 있는 '`- [x] 질문 · 답`으로 적으라'는 설명 글(세 곳에 복사돼 있음)도 한곳으로 모을까요? · 두기
- [x] 작업 브랜치는 어디서 시작할까요? · 확인 번호 브랜치 위에 새로
- [x] `* [ ] 질문`처럼 줄표 대신 별표나 더하기로 쓴 줄도 질문으로 볼까요? · 질문으로 봄
- [x] 체크는 했는데 답이 없는 줄에 '답이 빠졌다'는 안내를 이번에 넣을까요? · 이번엔 넣지 않음
- [x] 이 범위로 진행해도 될까요? · 진행
- [x] 테스트는 카드 모듈 테스트 한 곳에서만 새로 쓰고, 다섯 곳은 기존 테스트로 확인할까요? · 카드 모듈 한 곳
- [x] 질문 밑에 들여써서 단 설명 줄(체크 칸 없음)은 어떻게 볼까요? · 설명으로 두고 넘어감

## 미확인
