# 0001. qh-cycle: Pocock·Karpathy 원칙을 qh 규칙보다 우선한다

- 날짜: 2026-11-17
- 상태: 채택

## 결정
- qh에 앞단(grilling → 용어집·ADR → interface 선택)과 순환(카드 3개마다 또는 주 1회 아키텍처 후보 → 사람이 1개 선택)을 `qh-cycle` skill로 더한다.
- mattpocock/skills(MIT)를 고정 커밋 그대로 vendor하고 수정하지 않는다. 범위: grilling, grill-with-docs, domain-modeling, codebase-design, improve-codebase-architecture, tdd, to-spec, to-tickets, implement, retro, writing-for-agents. code-review·setup-matt-pocock-skills는 제외하고 각각 `qh review`, `qh init`이 대신한다.
- 충돌 시 이 원칙이 기존 qh 규칙보다 우선한다. 바꾸는 규칙:
  - 중복: 만진 파일의 기존 중복은 막지 않고 리뷰 경고 + 아키텍처 후보로. 새로 만든 중복은 계속 막는다.
  - 테스트 동반: 작업 카드 `## 테스트 위치(seam)`의 seam에 테스트가 있는지로 판정. seam이 없는 작은 변경은 `테스트 불필요: 이유`.
  - 큰 파일·함수 래칫은 유지. 사람이 고른 deepening 작업이면 `큰 파일 허용` 결정 줄을 제안(사람 승인).
- 사람 결정 지점은 4곳(범위 확정, interface 선택, 완료 리뷰, 아키텍처 후보 선택). 이유 한 줄은 interface·아키텍처 선택에서만 필수.
- 화면은 로컬 HTML만. 사용자 수준(A 비개발자 / B 개발자)에 따라 상세도가 다르다.

## 이유
- 리팩터를 red→green 루프 안에서 하면 루프가 길어지고, 테스트를 모든 엣지에 흩으면 구현에 묶인다(Pocock tdd·codebase-design).
- 원문을 번역·재작성하면 skill 효과가 같다는 보장이 없다. 에이전트용 영어는 병목이 아니고, 사람에게 보이는 화면만 쉬운 한국어면 된다.
- 고르기만 하는 구조는 무검토 승인이 된다. 되돌리기 비싼 두 지점에만 이유를 요구한다.

## 버린 대안
- 별도 하네스(새 상태 파일·새 skill 묶음): qh에 같은 장치가 이미 있어 두 번 만든다.
- Pocock skill을 qh 말투 한국어로 재작성: 효과 동일성을 잃는다.
- 아키텍처 리팩터 자동 실행: 에이전트가 대신 고르게 된다.
- 플러그인 통째 설치: 내장 /code-review와 이름 충돌, 불필요한 skill description이 컨텍스트에 상주.

## 다시 볼 조건
- 시범(gureumi 2주) 지표에서 이유 칸 공란·5자 미만 비율이 높거나, 래칫이 deepening을 반복해서 막거나, /usage가 크게 늘면.
