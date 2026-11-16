# Stop 훅 무한 반복 수정

## 원하는 결과
에이전트가 고치지 못한(아무것도 바꾸지 않은) 상태에서 Stop 훅이 같은 이유로 끝없이 막지 않는다.

## 성공 조건 → 검사
- 같은 트리·같은 고칠 일로 반복 Stop → 막지 않고 systemMessage로 사용자에게 알림 → test/qh.test.js "stop does not block again when the agent changed nothing since the last block"
- 그 뒤 코드가 바뀌면 다시 막음 → 같은 테스트
- 코드를 계속 바꿔도 같은 항목이면 연속 5번 뒤 멈춤 → "stop gives up after repeated blocks..."
- 사람에게 물을 것은 내용당 한 번 (stop_hook_active 없이도) → "a question for the person is asked once..."
- 기존 동작 유지 → npm test 전체

## 판단 필요

## 미확인
- Kiro Stop 훅 입력에 stop_hook_active가 있는지 모름. 이제 의존하지 않으니 결과에는 영향 없음.
- Claude Code가 block 반복에 상한을 두는지: 문서 확인 안 함. gureumi 로그로 8회 이상 반복만 확인.

ADR 불필요: 훅 반복 처리 한 군데 수정, 구조 변경 아님
