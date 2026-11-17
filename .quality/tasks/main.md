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
