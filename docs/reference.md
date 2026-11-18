# VibeRail(qh) 사용 설명서 — 개발자용

처음 쓰는 분은 [README](../README.md)부터 보세요. 구조와 흐름 그림은 [architecture.md](architecture.md)에 있습니다.

## 터미널로 직접 설치

Node 24 이상, git 저장소가 필요하다.

```sh
git clone https://github.com/HaeDalWang/VibeRail.git ~/VibeRail
cd 내-프로젝트 && node ~/VibeRail/bin/qh.js init . && git add -A && git commit -m "chore: qh 설치"
```

`init`은 사람이 쓴 파일을 덮어쓰지 않는다. 커밋하지 않은 변경이 있는 파일을 바꿔야 하거나 같은 규칙·hook이 이미 두 곳에 있으면 아무것도 바꾸지 않고 멈춘다. 코드 지도([code-review-graph](https://github.com/tirth8205/code-review-graph))가 있으면 함께 연결한다. 그다음 `node .quality/qh/bin/qh.js ask`로 질문 화면, `measure`로 리포트를 만든다. PR의 AI 리뷰는 `.quality/config.json`의 `review.cmd`로 돈다. `init`은 `kiro-run`이 있으면 그것을, 없고 `claude`가 있으면 Claude Code headless(`claude -p`, 읽기 도구 Read·Grep·Glob만, 답은 구조화 출력으로 받아 `result.json`에 씀)를 채운다.

## 하는 일


- **증거로 판정**: 검사 결과를 그 검사를 실행한 작업 트리 해시에 묶어 둔다. 실행한 뒤 코드가 바뀌었으면 통과로 치지 않는다.
- **턴마다 막음**: Stop hook이 빠른 검사를 돌린다. 결과는 세 가지로 나눈다.
  - `AI가 고칠 일`: 에이전트를 되돌린다.
  - `사람에게 물을 일`: 사용자에게 묻게 한다.
  - `환경 오류`: 코드를 고치지 않고 보고하게 한다.
  - 같은 항목으로 연속 2번 막으면 그 항목은 그만 막고 사용자에게 한 번 알린다. 사람에게 물을 일은 내용당 한 번만 묻는다.
- **PR에서 전부 확인**: 전체 테스트를 돌리고, 설치 상태를 점검하고(`qh doctor`), AI 리뷰를 받는다.
- **느린 테스트**: 전체 테스트가 오래 걸리면 PR 때만 돌리고(`"on": ["pr"]`), Stop에서는 이번 작업의 테스트만 돌린다. 검사 명령에 `{tests}`를 쓰면 이번 작업에서 바뀐 테스트 파일과, 바뀐 코드와 이름이 같은 테스트(`src/auth.js` → `auth.test.js`)로 채워진다. 돌릴 테스트가 없으면 그 검사는 건너뛴다.
  ```json
  "test": { "cmd": "npm test", "on": ["pr"], "timeoutSec": 1800 },
  "test-work": { "cmd": "npm test -- {tests}", "on": ["stop"] }
  ```
- **항상 켜지는 최소 안전선** (질문 없이 켜짐, Stop·PR 모두)
  - TDD: 코드가 바뀌면 같은 작업에 테스트 변경이 있어야 한다.
  - "코드"는 이 프로젝트가 쓴 코드만 뜻한다. `vendor/`·`third_party/`·`node_modules/` 아래와 `.min.` 파일은 남의 코드라 모든 검사(테스트·문서·큰 파일·중복·측정)에서 뺀다.
  - 문서 영향: 코드가 바뀌면 문서도 바뀌어야 한다.
  - ADR: 위험 영역(`config.risks`)이 바뀌면 `docs/adr/`에 ADR이 있어야 한다.
  - 위 셋은 필요 없으면 작업 카드에 `테스트 불필요: 이유` 같은 한 줄로 넘긴다.
  - 결정 로그: 품질 기준(config·권한 표)이 바뀌면 `docs/decisions.md`에 한 줄을 남긴다.
  - 비밀값: 바뀐 파일에서 키·토큰·`.env`를 찾는다. 찾은 값은 출력하지 않는다. 가짜 값에 `qh:allow-secret`을 달아도 사람이 "가짜가 맞다"고 답하기 전에는 PR이 막힌다(아래 사람 확인 면제).
  - 사람 확인이 필요한 면제: `grilling 불필요`·`qh confirm`·`qh:allow-secret`은 에이전트가 글을 써도 효력이 없고, 작업 카드 `## 판단 필요`에 `- [x] <qh가 보인 질문 그대로> · <사용자 답>` 줄이 있어야 인정된다(카드는 커밋되므로 CI도 같은 답을 본다. `- [ ]`로 남으면 열린 결정으로 막는다. 파일 줄이 사람의 답임을 증명하지는 못한다). `테스트 불필요`·`문서 영향 없음`·`ADR 불필요`·`qh:allow-pii`는 에이전트가 쓸 수 있고, `qh pr`이 한데 모아 리뷰어에게 보인다.
- **구조 래칫** (이번 작업이 만진 파일만, Stop·PR 모두)
  - 중복: 만진 파일의 중복 줄이 base보다 늘면 막는다(설정 없이 항상). 원래 있던 중복은 막지 않고 "아키텍처 점검 후보" 경고로만 보여 준다(ADR 0001, `qh status`, Stop에서는 사용자에게만 보이는 경고 줄). 기존 위치를 알려 준다. 옛 설정의 `structure.duplicates: "grown"`은 그대로 둬도 되고 아무것도 바꾸지 않는다. 예외는 `docs/decisions.md`에 `중복 허용: 파일 · 이유`를 쓸 때만 인정한다.
  - 중복 합계: `qh init`과 `qh pr`이 저장소 전체 중복 줄 수와 많은 파일 3개를 보여 준다. 참고용이고 막지 않는다.
  - 큰 파일: 800줄을 넘은 코드 파일은 더 늘릴 수 없다.
  - 루트 파일: 저장소 맨 위에 새 파일을 만들려면 결정 로그에 이유를 남긴다.
  - 죽은 링크: 바뀐 문서에 없는 파일을 가리키는 링크가 있으면 막는다.
- **설정으로 켜는 구조 래칫** (`.quality/config.json`의 `structure`, 키가 없으면 꺼짐)
  - `flatRoots: ["src/widgets"]`: 그 폴더 바로 아래 새 파일을 막는다. 하위 폴더에 둔다. 예외는 결정 로그 `루트 파일: 경로 · 이유`. 결과지에 "정리 대상 폴더 맨 위 파일" 지표가 붙는다.
  - `noGrow: ["DEPLOY.md"]`: 그 문서의 줄 수나 바이트가 늘면 막는다. 예외는 `문서 증가 허용: 경로 · 이유`.
  - `forbidden: ["docs/plans/"]`: 그 아래 새 파일을 막는다.
  - `patterns: [{ "name", "regex", "in": "docs"|"comments", "exclude": ["docs/reports/"], "fix" }]`: 바뀐 파일에서 매치 수가 늘면 막는다. docs는 `.md`의 코드 블록 밖, comments는 코드 주석만(문자열은 안 셈).
  - `backtickRefs: true` 또는 `["lib"]`: 바뀐 문서의 백틱 안 경로(`` `src/x.js` ``)도 죽은 링크로 본다. 목록은 맨 위 폴더 말고 더 찾아볼 기준 폴더. 켜면 파일을 지우거나 옮길 때 그 파일을 가리키던 다른 문서도 본다.
  - `functions: { "maxLines", "componentMaxLines", "complexity", "maxDepth", "maxParams", "maxNestedCallbacks" }`: 바뀐 JS 파일에서 한도를 넘는 함수가 base보다 늘면 막는다. 이미 넘은 것은 그대로 둔다. 컴포넌트·훅(대문자·`useX` 이름)은 `componentMaxLines`(`componentDirs: ["src/"]`를 주면 그 아래만). 프로젝트의 ESLint(`node_modules/eslint`)로 읽는다. 주석 패턴도 같다(구문 분석이 안 되는 파일은 파일 전체에서 센다).
  - `unused`·`cycles`·`similar: true`: 저장소 전체를 knip(안 쓰는 파일·의존성·export)·dependency-cruiser(순환 참조)·jscpd `--similarity`(이름만 바꾼 복사 함수)로 본다. 느려서 PR에서만 돈다. `qh baseline`이 지금 항목을 `.quality/baseline.json`에 "기존"으로 적고, PR은 거기 없는 새 항목을 막는다. 기준선에 항목이 늘면 사람 확인으로 올라간다. 도구는 프로젝트에 설치돼 있어야 한다(qh가 설치하지 않음). `unused`는 knip이 못 보는 CommonJS 모듈 객체 사용(`ns.fn()`)을 프로젝트 ESLint로 읽어 빼므로 ESLint도 필요하다.
- **답에 따라 켜지는 검사** (`qh ask`로 고른 답, 안 고른 질문은 권장안)
  - 답이 요구하는 설정·문서가 없으면 `qh doctor`가 실패를 낸다. PR이 막힌다. 예: "로그인 기능 있음"인데 권한 검사가 없음, "운영 배포 대상"인데 `docs/operations.md`가 없음.
  - 개인정보 취급함: 바뀐 로그 줄에 이메일·전화번호·비밀번호 같은 이름이 들어가면 막는다. 오탐이면 그 줄에 `qh:allow-pii`.
  - 외부 API 연동 있음: 위험 영역 `external`이 바뀌면 같은 작업의 테스트에 실패 상황(시간 초과·5xx·거절)이 있어야 한다. 필요 없으면 작업 카드에 `연동 실패 테스트 불필요: 이유`.
- **작업 순환 (qh-cycle)** (ADR 0001) `qh init`이 Pocock skill 10개(`skills/vendor/mattpocock-skills/`, 고정 커밋 원문, 수정 금지·갱신은 `scripts/vendor-pocock.sh`)와 `qh-cycle` skill을 `.claude/skills/`에 그대로 설치한다(다시 init하면 덮어씀). `docs/agents/`의 세 문서와 `.scratch/`는 없을 때만 만든다. 작업 카드의 세 절이 순환을 움직인다.
  - `## 의도`: 비어 있고 `grilling 불필요: 이유`도 없이 코드가 바뀌면 막는다. 이 제목이 있는 카드에만 적용(옛 카드는 그대로).
  - `## interface 결정`: 내용이 있는데 `이유:` 줄이 없거나 5자 미만이면 막는다. `docs/decisions.md`에 더한 `아키텍처 점검: 날짜 · 후보 · 이유` 줄도 같다.
  - `## 테스트 위치(seam)`: 한 줄에 경로 하나. 있으면 TDD는 그 경로 아래·같은 이름의 테스트가 바뀌었는지로 판정하고, 없으면 기존 패키지 단위 판정.
  - 용어집: `GLOSSARY.md`가 있을 때 바뀐 코드에 새로 생긴 타입·클래스 이름이 거기 없으면 경고만 한다. `GLOSSARY.md`·`GLOSSARY-MAP.md`는 루트 파일 이유가 필요 없다.
  - SessionStart와 `qh cycle`이 카드 단계(의도 → interface 결정 → 테스트 위치 → 완료)와 다음 결정을 한 줄로 보이고, 카드 3개 또는 7일(기본값, 아래 `limits`)마다 "아키텍처 점검 시기"를 알린다.
- **작업 질문** (위험 영역을 건드린 작업만)
  - 끝낼 때 qh가 짧은 질문 하나를 낸다(예: DB → "이미 쌓인 데이터를 바꾸거나 지우나요?"). 에이전트가 채팅으로 묻고, 답을 작업 카드에 `작업 질문 db: A 사유`로 적는다.
  - "변경 있음"(A)이면 ADR이 꼭 있어야 한다. `ADR 불필요`가 통하지 않는다.
  - 질문 절차와 에이전트가 직접 질문을 만들 때 지킬 모양은 `lib/ask-guide.md`에 있다.
- **내장 검사**
  - 권한 표(`route-access`): Express 5 라우트마다 접근 수준을 선언하고, 낮은 권한으로 요청했을 때 거부되는지 확인한다.
  - SQL 검사(`sql-prepare`): 코드 안의 SQL을 빈 테스트 DB에서 PREPARE해 본다.

## 기본값과 근거

근거가 없는 값은 `.quality/config.json`의 `limits`로 바꾼다(양의 정수가 아니거나 없는 키면 기본값을 쓰고 `qh doctor`가 경고한다).

| 값 | 하는 일 | 근거 | 설정 키 |
|---|---|---|---|
| 800줄 | 이 줄 수를 넘은 코드 파일은 더 늘릴 수 없다 | 같은 값: [Qt Axivion `CodingStyle-LinesOfCodeInFile`의 기본 `max_value` 800](https://doc.qt.io/axivion/reference/analysis_configuration/CodingStyle-LinesOfCodeInFile.html). 참고로 [ESLint `max-lines` 기본은 300](https://eslint.org/docs/latest/rules/max-lines) | 없음(고정) |
| 6줄 | 의미 있는 줄이 이만큼 이어서 같으면 중복 | 근거 없음: 프로젝트가 바꿀 수 있는 기본값. 참고로 [jscpd 기본은 `--min-lines` 5, `--min-tokens` 50](https://unpkg.com/jscpd@5.1.0/README.md)인데, qh는 import·짧은 줄·데이터 줄을 빼고 세므로 같은 기준이 아니다 | `limits.duplicateLines` |
| 8자 | 이보다 짧은 줄은 중복을 셀 때 뺀다 | 근거 없음: 프로젝트가 바꿀 수 있는 기본값 | `limits.duplicateLineChars` |
| 5자 | `테스트 불필요:`·`이유:`·허용 줄의 이유 최소 길이 | 근거 없음: 프로젝트가 바꿀 수 있는 기본값 | `limits.reasonChars` |
| 카드 3개 / 7일 | 지난 아키텍처 점검 뒤 이만큼 지나면 점검 시기를 알린다 | 근거 없음: 프로젝트가 바꿀 수 있는 기본값(ADR 0001에서 정한 주기) | `limits.architectureCards` / `limits.architectureDays` |
| 10초 | `qh doctor`가 Stop에서 도는 검사의 마지막 실행이 이보다 길면 경고 | 근거 없음: 프로젝트가 바꿀 수 있는 기본값(경고만 하고 막지 않는다) | `limits.stopSeconds` |

## 명령

| 명령 | 하는 일 |
|---|---|
| `qh init [경로]` | 설치·연결 |
| `qh ask` | 프로젝트 질문 화면(로컬 HTML)을 만든다. 고른 답을 "프롬프트 복사"로 에이전트에 전달 |
| `qh answer` | 붙여 넣은 답을 검증해 `.quality/config.json`과 결정 로그에 저장 |
| `qh view interface <json>` | interface 안(JSON)을 로컬 HTML로 만든다(`.quality/reports/`). 안마다 이유 칸과 `안: <id>`·`이유: …` 두 줄 복사 버튼(이유 5자 미만이면 복사 거부). 사용자 수준 B(`qh ask`의 사용자 수준)는 signature·seam도 보인다. Mermaid는 함께 넣은 로컬 사본으로 그리고, 못 그리면 원본 글이 보인다 |
| `qh view architecture <json>` | 아키텍처 점검 후보(JSON: `title`, `candidates[{id, name, problem, solution, gain, cost, strength, mermaidBefore?, mermaidAfter?, detail?}]`)를 한국어 로컬 HTML로 만든다. 후보마다 이유 칸·복사 버튼은 interface 화면과 같고, `detail`은 사용자 수준 B에만 보인다. 외부 주소를 부르지 않는다(Mermaid도 로컬 사본). improve-codebase-architecture skill의 HTML 보고서 단계(CDN·영어) 대신 쓴다 |
| `qh view glossary` | `GLOSSARY.md`를 로컬 HTML로 만든다 |
| `qh cycle` | 지금 카드의 단계, 다음에 사람이 정할 것, 아키텍처 점검 시기를 한 줄로 |
| `qh doctor` | 설치·설정 전체 점검 |
| `qh check [이름…] [--pr]` | 필요한 검사 실행. `--pr`은 올리기 직전에만 도는 검사까지 돌린다 |
| `qh status [--json] [--pr] [--base ref]` | 상태표. `--base`는 CI가 머지 대상을 알 때 `config.baseRef` 대신 쓴다. `--pr`은 PR이 막힐 문제가 남아 있으면 0이 아닌 값으로 끝난다(AI 리뷰는 돌리지 않음). CI는 `qh check --pr` 다음 이것을 돈다 |
| `qh pr` | PR 직전 판정 (검사 전부 + 점검 + AI 리뷰) |
| `qh routes --baseline --levels a,b,c` | 지금 앱 동작으로 권한 표 첫 버전 만들기 |
| `qh measure [--backfill 주]` | 지금 상태를 재서 `.quality/metrics.csv`에 한 줄 더하고 결과지(HTML)를 `.quality/reports/날짜-커밋.html`로 쌓는다. `--backfill 8`은 지난 8주를 소급해 qh 전 흐름도 남긴다 |

## 측정 결과지

`qh measure`는 측정할 때마다 `.quality/metrics.csv`에 한 줄을 더하고(지우지 않음), 처음과 지금, 항목별 이력을 보여 주는 결과지를 `.quality/reports/`에 날짜·커밋 이름으로 쌓는다(지우지 않음). 지난 결과지를 열어 그때 상태와 비교할 수 있다. 저장소에 올릴지는 프로젝트가 정한다(올리지 않으려면 `.gitignore`에 `.quality/reports/`).

개선·악화를 매기는 지표는 네 개다. 결과지에 지표마다 뜻, 나빠지면 무엇이 나빠지는지, 받아들이는 법이 함께 나온다.

| 지표 | 단위 | 0이어야 하나 |
|---|---|---|
| 800줄 넘는 코드 파일 | 개수 | 아니다. 이미 큰 파일은 두고, 더 키우는 작업만 막는다 |
| 중복 코드 비율 | 코드 줄 대비 % | 아니다. 결정 로그의 `중복 허용: 파일 · 이유`로 받아들인 파일은 빠진다 |
| 테스트가 안 붙은 코드 파일 | % | 아니다. 결정 로그의 `테스트 없음 허용: 파일 · 이유`로 받아들인 파일은 빠진다 |
| 없는 파일을 가리키는 문서 링크 | 개수 | 그렇다. 점(.) 폴더(도구 설정·외부 스킬 사본)는 세지 않는다 |

결정 로그 줄 수, ADR 수, 기능 1건당 수정 파일 수, Stop이 에이전트를 돌려보낸 횟수, 규모는 참고로만 보여 준다.

- 기준은 qh를 처음 커밋하기 직전 값이다. 그 전의 흐름은 "qh와 상관없는 변화"로 따로 보여 준다. 목표치는 두지 않는다.
- 측정 규칙이 바뀌면 행의 `rules` 번호가 올라가고, 같은 번호끼리만 비교한다. `qh measure --backfill 8`로 과거를 새 규칙으로 다시 잰다.
- `vendor/`·`third_party/`·`node_modules/` 아래 코드는 남의 코드라 세지 않고 중복 비교에도 넣지 않는다.

qh를 넣기 전에 `qh measure --backfill 8`을 한 번 돌려 두면 넣은 뒤와 비교할 기준이 남는다. 측정 기록은 검사 증거를 무효로 만들지 않는다.

## 상태

만드는 중이다. 다음에 만들 것:

- 실제 프로젝트에 붙여 보는 시험

## 개발

```sh
npm install
npm test
```
