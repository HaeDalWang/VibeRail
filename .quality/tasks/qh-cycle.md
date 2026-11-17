# qh-cycle: 앞단(의도→용어→interface)과 순환을 qh에 더한다

## 의도
사람은 고르고 이유를 남기고, 에이전트는 묻고·그리고·만들고·검토한다. 설계 결정 D0~D26은 docs/adr/0001-pocock-karpathy-principles-over-qh.md와 docs/decisions.md.

## 원하는 결과
`qh init`을 한 프로젝트에서 작업 카드 하나가 grilling → 용어집·ADR → interface 그림 선택(이유) → spec·tickets → seam에서 tdd → qh review → retro로 돈다. 카드 3개 또는 7일마다 아키텍처 후보를 사람이 하나 고른다.

## 성공 조건 → 검사
- `qh init`이 Pocock skill 10개를 고정 커밋 원문 그대로 `.claude/skills/`에 설치하고 `qh-cycle` skill도 설치 → test/init-skills.test.js
- 설치본에 upstream MIT LICENSE가 같이 들어감 → 같은 테스트
- vendor 원문과 설치본이 바이트 단위로 같음 → 같은 테스트
- `qh init`이 docs/agents/*.md 3개·.scratch/를 없을 때만 만든다(있으면 그대로). GLOSSARY.md는 만들지 않음(upstream이 첫 용어 때 루트에 생성, D27) → 같은 테스트
- 카드 `## 의도`가 비고 `grilling 불필요:` 선언도 없이 코드가 바뀌면 Stop이 막음 → test/cycle-policy.test.js
- `## interface 결정`·아키텍처 선택에 이유가 5자 미만이면 막음 → 같은 테스트
- 카드에 `## 테스트 위치(seam)`가 있으면 그 seam 경로 테스트가 바뀌었는지로 TDD 판정, 없으면 기존 판정 → 같은 테스트
- 새 init 설정은 `structure.duplicates: "grown"` → test/init-skills.test.js
- 바뀐 코드에 용어집에 없는 새 도메인 이름이 있으면 리뷰 경고(막지 않음) → test/cycle-policy.test.js
- `qh ask`에 사용자 수준 질문(A/B)이 있고 답이 config.answers.level → test/qh.test.js
- `qh view interface <json>`·`qh view glossary`가 로컬 HTML을 만든다(외부 요청 없음, Mermaid는 로컬 사본) → test/view.test.js
- SessionStart가 카드 단계와 다음 결정 한 줄, 아키텍처 점검 시기를 보인다 → test/cycle-policy.test.js
- 기존 동작 유지 → npm test 전체

## interface 결정

## 테스트 위치(seam)

## 판단 필요

## 미확인
- disable-model-invocation skill을 Skill 도구로 못 부르는지: 문서 기준 추정. 시범 첫 카드에서 확인.

루트 파일: skills · Pocock 원문 vendor와 qh-cycle skill을 lib(평면 복사)와 분리해 두려고
