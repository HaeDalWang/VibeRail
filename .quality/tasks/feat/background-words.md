# 질문 말을 사람 배경에 맞추기 (G2)

## 의도
지금은 개발자/비개발자 둘로만 나눠, 비개발자면 말을 일괄로 쉽게 낮춘다. 그게 오히려 이해를 어렵게 할 때가 많다(사용자 관찰). 그 사람의 직책·업무·살아온 배경으로 그 사람 분야의 말로 바꿔 주는 단어집을 쉽게 만들고, 그릴링 질문·선택지를 그 말로 낸다.

범위 (그릴링 2026-11-26):
- 처음 질문 화면의 "개발에 얼마나 익숙하세요?" 아래에 하는 일·배경을 자유롭게 쓰는 칸. 비우면 지금과 같음. 이미 설치한 곳은 질문 화면을 다시 열면 보임. 개발자(B)도 같음.
- 배경과 단어집은 저장소에 올리지 않는 파일 하나에 함께 둠(사람마다 따로).
- 배경이 있고 단어집이 없으면 첫 그릴링 전에 AI가 자주 나오는 개발 말 10개 안팎을 그 분야 말로 바꾼 초안을 만들어 대화에 한 번 보여 주고 바로 씀. 사람이 모르겠다고 한 말은 한 줄씩 더함. 틀린 말은 말하거나 파일을 직접 고침.
- 맞는 말이 없으면 개발 말 그대로 + 괄호에 짧은 풀이.
- A/B 구분은 유지(세부를 보여 주나만 정함). "비개발자면 무조건 쉽게"는 단어집으로 바뀜.
- 적용: AI가 쓰는 말 전부(그릴링 질문·선택지, 고르는 화면, 끝 보고). 검사기의 정해진 문장은 그대로.
- 검사기는 단어집을 검사하지 않음. AI 규칙·순환 안내에 한 줄씩.
- 비목표: 검사기 문장 치환, 단어집 품질 판정, 팀 공용 단어집.

## 성공 조건 → 검사
- 질문 화면 배경 칸(미리 채움, 채웠을 때만 복사) → test/criteria-answers.test.js "the question page has a background box…"
- 배경 줄만 있는 답도 저장, 설정·결정 로그 없음 → "a block with only a background line…"
- 단어집·다른 글 그대로 → "saving a new background keeps the word list…"
- 500자 넘으면 거절 → "a background over the length cap…"
- 예전 설치도 저장 전에 .gitignore → "an old install whose .gitignore lacks…"
- 세션 시작 한 줄 세 상태 → test/cycle-policy.test.js "SessionStart … word list…" 3개
- init이 파일을 저장소에서 뺌, 규칙·순환 안내가 단어집을 말함 → test/init-gitignore.test.js
- 기존 동작 유지 → npm test 전체

ADR 불필요: 로컬 파일 하나와 안내 한 줄 추가, 저장 형식·구조 변경 없음. 결정은 docs/decisions.md 2026-11-26 한 줄

## 용어
- 단어집: 개발 말을 그 사람 분야의 말로 바꾼 표. 사람마다 따로, 저장소에 안 올림.
- 용어집(GLOSSARY.md): 프로젝트가 다루는 일의 말, 팀 공용. 단어집은 용어집에 있는 말을 바꾸지 않음.

## 판단 필요
- [x] 이 범위로 진행할까요? · 진행 (사용자 원문 "ㅇㅇ 진행", qh가 ㅇㅇ를 예로 못 읽음)
- [x] 명세(확인 번호 7945)대로 작업을 시작할까요? · 돌려
- [x] 질문 화면에서 배경 칸을 비우고 저장해도, 명세대로 전에 쓴 배경은 지워지지 않아요. 어떻게 할까요? · 칸에 안내 한 줄

## 미확인

## interface 결정
안: A · 확인 번호 3983
설계안: .scratch/background-words/interface.json
명세: .scratch/background-words/spec.md
이유: 컨텍스트가 커지지만 무조건 우선 들어간다는 점에서 선택

## 테스트 위치(seam)
test/criteria-answers.test.js
test/cycle-policy.test.js
test/init-gitignore.test.js

## 루프
.scratch/background-words/issues/01-background-saved.md
.scratch/background-words/issues/02-session-start-line.md
.scratch/background-words/issues/03-init-rules-docs.md
