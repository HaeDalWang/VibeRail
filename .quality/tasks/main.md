# Stop 훅 무한 반복 수정

## 원하는 결과
에이전트가 고치지 못한(아무것도 바꾸지 않은) 상태에서 Stop 훅이 같은 이유로 끝없이 막지 않는다.

## 성공 조건 → 검사
- 같은 트리·같은 고칠 일로 반복 Stop → 막지 않고 systemMessage로 사용자에게 알림 → test/qh.test.js "stop does not block again when the agent changed nothing since the last block"
- 그 뒤 코드가 바뀌면 다시 막음 → 같은 테스트
- 코드를 계속 바꿔도 같은 항목이면 연속 2번 뒤 멈춤 → "stop gives up after repeated blocks..."
- 사람에게 물을 것은 내용당 한 번 (stop_hook_active 없이도) → "a question for the person is asked once..."
- 기존 동작 유지 → npm test 전체

## 판단 필요

## 미확인
- Kiro Stop 훅 입력에 stop_hook_active가 있는지 모름. 이제 의존하지 않으니 결과에는 영향 없음.
- Claude Code가 block 반복에 상한을 두는지: 문서 확인 안 함. gureumi 로그로 8회 이상 반복만 확인.

ADR 불필요: 훅 반복 처리 한 군데 수정, 구조 변경 아님

## 추가: 기준 확인 기록 (qh confirm)
- 사람이 확인한 품질 기준은 지문(설정+권한 표 해시)으로 결정 로그에 남아 다시 묻지 않음, 바뀌면 다시 물음 → test/qh.test.js "a person confirms the criteria once with qh confirm..."
- 사람에게 묻는 문장은 쉬운 말로 (훅 지시문, lib/ask-guide.md "기준 확인")

## 추가: 전면 점검에서 나온 막힘 (내 몫)
- 선언 줄을 흔한 마크다운 모양(체크박스·인용·굵게·백틱·전각 콜론)으로도 읽고, 이유가 짧으면 5자 이상이라고 알림 → test/card.test.js
- 한글·점이 든 위험 영역 이름의 작업 질문 답 인식 → test/card.test.js
- 지운 .env·URL만 든 .env 변형은 막지 않음, Tests 폴더·*Tests 클래스·.cy. 파일을 테스트로 셈 → test/card.test.js
- 큰 파일: 이름 변경·vendor·.min.·.sql 제외, 결정 줄 허용, 800줄 정확히 통과 / 잘못된 % 링크에 죽지 않음 → test/big-file.test.js
- 문구 표(키: 값만 있는 줄)는 중복으로 세지 않음 → test/big-file.test.js "a table of text entries is data, not copied code"

## 추가: 전면 점검에서 나온 막힘 (Kiro 몫)
- 검사가 추적 파일을 바꾸면 환경 오류, 측정 파일은 바뀐 파일에서 빠짐, exit 126/127·DB 연결 거부는 환경 오류, 깨진 증거·기준선 JSON은 미실행, 한글 파일명, 환경 오류만이면 exit 3, 공통 조상 없음은 unshallow 안내 → test/gate-run.test.js
- `status --base`가 기준 변경으로 안 잡힘, 코드 지도 없음은 경고, 사람 몫 doctor 실패는 "사용자에게 보고", 리뷰 환경 오류는 환경 오류 목록, 기존 실패 허용 → test/pr-gate.test.js, test/card.test.js
- Stop: 환경 오류만이면 "판정하지 못함", 공통 조상 없음은 사용자에게 한 번 알림, 사용자에게는 쉬운 문장만 → test/stop-hook.test.js, test/user-words.test.js
- 문서 영향 없음: lib/ask-guide.md(기존 실패 허용)와 docs/decisions.md에 반영, README의 사용자 흐름은 그대로
- ADR 불필요: 판정 분류와 문구 수정, 저장 형식·구조 변경 없음 (lib/triage.js는 bin/qh.js에서 옮긴 것)

## 추가: e2e 점검 판정 규칙 (Y 몫)
- 안내의 자리표시를 `<왜 필요 없는지, 5자 이상>`로, 자리표시 그대로는 거절(A03) / lock·도구 설정 파일은 루트 파일·TDD 제외(A08) / 지운 코드는 TDD 대상 아님(A09) / TDD 패키지별(A12) / 허용 줄 이유 5자·자리표시 거절·사용자 허락 뒤에만(A17·B9) / 충돌 표시 막음(A18) / `{tests}` 같은 언어만(B4) / git이 무시하는 .env는 비밀값 파일 아님(B8) → test/rules-e2e.test.js
- init 테스트 명령 감지(pytest·go test·하위 package.json), 못 찾으면 알림(A13) → test/init-detect.test.js
- 문서 영향 없음: 판정 규칙과 안내 문구만 바뀜, 사용자 흐름(README)은 그대로. 결정은 docs/decisions.md 2026-11-17 세 줄
- ADR 불필요: 판정 함수 안의 규칙 변경, 저장 형식·구조 변경 없음

## 추가: e2e 점검 Stop 훅·사람 문장·Kiro (X 몫)
- 포기한 항목 알림은 쉬운 말로 한 번(A01·B7), 항목별 연속 2번(A02), 세션별 상태(B6), Kiro 입력이면 직접 확인·전할 말·다음 세션 시작에 다시 알림(B2·B3), 깨진 설정·커밋 0개(A07·A16), 명령 검사의 연결 실패는 환경 오류(A06), probe 빈 틀은 허락 질문(A05), 커밋 기록의 비밀값(A10), Express 아니면 권한 요구는 경고(A11), 판단 필요 체크박스 안내(B5) → test/hook-flow.test.js
- 검사·위험 영역·라우트 질문을 쉬운 말로(A04·M1·B1·A15), 결과지 문구(A19), 에이전트 규칙(B5·B9·B10) → test/user-facing.test.js
- 문서 영향 없음: 사람 흐름(README)은 그대로, 에이전트 규칙은 lib/agents-snippet.md·lib/ask-guide.md에 반영, 결정은 docs/decisions.md 2026-11-17 세 줄
- ADR 불필요: Stop 상태 파일 모양(세션별)만 바뀜, 옛 파일은 버리고 다음 Stop에서 한 번 더 막을 뿐

## 추가: X·Y 결과 점검 뒤 보완 (내 몫)
- 묻지 않은 라우트 줄은 답이 아님 → test/user-facing.test.js "a route qh asked the person about ..."
- .env에 넣었다 뺀 키도 pr이 막음 → test/hook-flow.test.js "the PR status blocks on an .env with a token committed ..."
- 설치 뒤 안내를 쉬운 말로(A19 나머지) → test/init-detect.test.js "the next step after install says in plain words ..."
- 문서: docs/architecture.md·docs/reference.md Stop 동작 갱신, lib/ask-guide.md에 사용자가 쓸 말 연결
- ADR 불필요: 판정 조건 보완, 구조 변경 없음
