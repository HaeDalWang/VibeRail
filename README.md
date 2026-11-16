# VibeRail

AI 에이전트(Claude Code·Kiro)와 개발하는 프로젝트에 품질 문지기를 붙인다. 바이브코딩은 자유롭게 하되, 에이전트가 프로젝트에서 정한 품질 기준을 벗어나지 않게 막는다.

명령 이름은 `qh`다.

## 하는 일

- **증거로 판정**: 검사 결과를 그 검사를 실행한 작업 트리 해시에 묶어 둔다. 실행한 뒤 코드가 바뀌었으면 통과로 치지 않는다.
- **턴마다 막음**: Stop hook이 빠른 검사를 돌린다. 결과는 세 가지로 나눈다.
  - `AI가 고칠 일`: 에이전트를 되돌린다.
  - `사람에게 물을 일`: 사용자에게 묻게 한다.
  - `환경 오류`: 코드를 고치지 않고 보고하게 한다.
- **PR에서 전부 확인**: 전체 테스트를 돌리고, 설치 상태를 점검하고(`qh doctor`), AI 리뷰를 받는다.
- **내장 검사**
  - 권한 표(`route-access`): Express 5 라우트마다 접근 수준을 선언하고, 낮은 권한으로 요청했을 때 거부되는지 확인한다.
  - SQL 검사(`sql-prepare`): 코드 안의 SQL을 빈 테스트 DB에서 PREPARE해 본다.

## 설치

Node 24 이상, git 저장소가 필요하다.

```sh
node /path/to/VibeRail/bin/qh.js init /path/to/project
cd /path/to/project
node .quality/qh/bin/qh.js doctor
```

`init`이 하는 일:

- qh를 `.quality/qh/`에 복사한다.
- Claude Code·Kiro hook, `AGENTS.md` 규칙 블록, 설정 초안(`.quality/config.json`)을 붙인다.
- 코드 지도([code-review-graph](https://github.com/tirth8205/code-review-graph))를 붙인다.

`init`이 지키는 것:

- 사람이 쓴 파일은 덮어쓰지 않는다.
- 커밋하지 않은 변경이 있는 파일을 바꿔야 하면 멈춘다.
- 같은 규칙이나 hook이 이미 두 곳에 있으면 멈춘다.

## 명령

| 명령 | 하는 일 |
|---|---|
| `qh init [경로]` | 설치·연결 |
| `qh doctor` | 설치·설정 전체 점검 |
| `qh check [이름…]` | 필요한 검사 실행 |
| `qh status [--json] [--pr]` | 상태표 |
| `qh pr` | PR 직전 판정 (검사 전부 + 점검 + AI 리뷰) |
| `qh routes --baseline --levels a,b,c` | 지금 앱 동작으로 권한 표 첫 버전 만들기 |

## 상태

만드는 중이다. 다음에 만들 것:

- 항상 켜지는 검사: TDD, ADR, 결정 로그, 문서 영향, 비밀값
- 변경분 중복 래칫
- 프로젝트별로 검사를 고르는 질문 화면(`qh ask`)

## 개발

```sh
npm install
npm test
```
