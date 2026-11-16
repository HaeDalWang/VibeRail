# Stop 훅 무한 반복 수정

## 원하는 결과
에이전트가 고치지 못한(아무것도 바꾸지 않은) 상태에서 Stop 훅이 같은 이유로 끝없이 막지 않는다.

## 성공 조건 → 검사
- 같은 트리·같은 고칠 일로 반복 Stop → 막지 않고 systemMessage로 사용자에게 알림 → test/qh.test.js "stop does not block again when the agent changed nothing since the last block"
- 그 뒤 코드가 바뀌면 다시 막음 → 같은 테스트
- 기존 동작 유지 → npm test 전체

## 판단 필요

## 미확인
- Claude Code가 block 반복에 상한을 두는지: 문서 확인 안 함. gureumi 로그로 8회 이상 반복만 확인.

ADR 불필요: 훅 반복 처리 한 군데 수정, 구조 변경 아님
