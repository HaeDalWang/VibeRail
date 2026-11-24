# 화면에 위치별 주석 달기와 답을 대화로 바로 보내기 (백로그 4·5)

## 의도
2026-11-24 grilling 결정(repo 밖 기록 ~/.local/share/intent/quality-harness/2026-11-24-backlog-decisions.md). 고르는 화면(interface·architecture)과 새 명세 화면에서 위치마다 주석을 달 수 있게 하고, Claude Code에서는 화면의 답을 복사·붙여넣기 없이 바로 받는다.

## 원하는 결과
- 안마다, 명세 문단마다 선택적 주석 칸이 있고 주석은 위치와 함께 답 글에 붙는다.
- Claude Code에서는 화면을 열고 기다리다 "보내기"를 누르면 답이 바로 세션에 들어온다. 한 번만 받는다.
- 시간이 지나거나 보내기가 실패하면 답을 잃지 않고 복사·붙여넣기로 돌아간다.
- 다른 호스트(Kiro 등)는 지금처럼 복사·붙여넣기.

## 성공 조건 → 검사
- interface·architecture 위치 주석과 빈 주석 제외 → `interface/architecture copies located annotations from all cards and omits empty annotations`
- 명세 단위별 주석·선택 질문 없음 → `spec renders heading paragraph and list units with optional annotations and no choices`
- 전송 실패·오류·중복 때 입력과 복사 유지 → `send network/500/409/success preserves annotations and copy fallback`
- 정상 전송·토큰·중복 → `wait serves token page and Mermaid, rejects wrong token then prints answer once with exit 0`, `wait rejects a second queued POST with already sent status`
- 시간 초과 안내·코드 → `wait timeout prints copy fallback and returns distinct exit 124`
- 실제 명령의 stdout·종료·대기 안내 → `wait command prints submitted text and exits 0`
- 전체 테스트 증거 → `/tmp/annotate-send-test.log`

## 설계 기록
- 승인된 범위와 성공 조건은 위 의도 및 사용자 작업 지시를 따른다.
- 명세: 이 카드의 의도와 성공 조건을 명세로 사용한다.
- ADR: `docs/adr/0002-view-answer-wait.md`
- 변경 범위: 화면 생성·일회성 서버·CLI 비동기 결과 수신·테스트·사용 안내. 기존 복사 흐름·검사 기준·배포 사본은 유지한다.

## 판단 필요
- [x] 이 범위로 진행할까요? · 예 (2026-11-24 결정 기록 확인: "ㅇㅇ 맞아 시작")

## 미확인
- 없음

## 검증 결과
- 코디네이터: npm test 421개 전부 통과(exit 0). Codex 쪽 EPERM 14개는 환경 문제였다.
- 코디네이터: 실제 브라우저(playwright)로 명세 화면을 열어 주석 2개 입력 → 보내기 → 세션에 `주석:` 두 줄이 위치와 함께 도착, exit 0. 두 번째 보내기는 "이미 보냈습니다".
- 코디네이터: 대기 모드 안내가 "직접 열어 주라"고 하던 것을 "이미 열렸다, 답이 아래 나온다"로 고침(테스트 먼저).
- 전체 테스트: 421개 중 407 통과, 14 실패, 종료 1 (`/tmp/annotate-send-test.log`).
- 새 서버 테스트 4개는 실제 포트의 `listen EPERM`. 기존 네트워크 실패 10개는 변경 전 HEAD를 임시 폴더에 풀어 동일 실패를 재현했다 (`/tmp/annotate-send-baseline.log`). 실패 허용은 추가하지 않았다.
- 화면·안내 집중 검사 24개 통과 (`/tmp/annotate-send-ui.log`). 실제 기존 명세 주석 61칸·설계안 주석 2칸을 생성해 화면 글을 읽었다. 실제 브라우저 확인과는 구분한다.
- qh check·status는 모두 종료 3: Git 임시 파일 생성 권한 오류. 품질 게이트 통과로 판정할 수 없다.
- 문서와 ADR 갱신, 새 의존성 없음, 금지 파일·배포 사본 변경 없음. CLI는 774줄이다.
- 판단·경우별 테스트 이름·실패 목록: `/tmp/annotate-send.ledger.md`.
