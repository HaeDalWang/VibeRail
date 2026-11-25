# Rust 지원

## 의도
요즘 만드는 도구의 절반 이상이 Rust다. Rust 프로젝트에서도 VibeRail이 처음부터 막히지 않고 제대로 판정하게 한다.

범위(grilling에서 정함):
- 설치할 때 맨 위 폴더에 Rust 프로젝트 파일(Cargo.toml)이 있으면 Rust 테스트 명령을 테스트 검사로 넣는다. 여러 묶음 구성(workspace)이면 전부 돌린다. 한 단계 아래 폴더는 찾지 않는다.
- 코드와 같은 파일 맨 아래에 쓴 Rust 테스트(`#[cfg(test)]` 부분)가 바뀌면 테스트를 쓴 것으로 인정한다.
- PR 직전 되돌려 보기 검사에서 Rust 파일은 테스트 부분은 그대로 두고 코드 부분만 되돌린다.
- Rust는 바뀐 테스트만 골라 돌리지 않고 늘 전체 테스트를 돌린다(지금 동작 그대로, 바꾸지 않음).

## 용어

## interface 결정
안: A · 확인 번호 5264
설계안: .scratch/rust-support/interface.json
이유: 바뀌는 곳이 두군데 이므로 추후 에러 추적등이 쉬울것 같다

## 테스트 위치(seam)
test/rules-e2e.test.js
test/red-check.test.js
test/init-detect.test.js

## 루프

## 성공 조건 → 검사
- 맨 위 Cargo.toml이면 `cargo test`, workspace면 `cargo test --workspace`, 한 단계 아래는 안 찾음 → test/init-detect.test.js "init drafts cargo test for a Rust crate" 외 2개
- 같은 파일 테스트 부분이 바뀌면 TDD 통과, 테스트 부분이 그대로면 TDD 막음, 새 파일의 테스트 부분도 인정 → test/rules-e2e.test.js "a changed test part at the bottom of a Rust file covers its code change" 외 2개
- 되돌려 보기에서 Rust 파일은 코드 부분만 되돌림 → test/red-check.test.js "red check reverts only the code part of a Rust file and keeps its new test part"
- 위쪽의 테스트 전용 한 줄(`#[cfg(test)] use …`)은 테스트 부분 시작이 아님 → test/rules-e2e.test.js "a test-only line near the top of a Rust file does not make the code below it a test"
- 기존 동작 유지 → npm test 전체
- 실제 cargo 프로젝트(scratchpad)에서 init·TDD·되돌려 보기 확인: cargo test 감지, TDD 막음 없음, 되돌려 보기 통과

ADR 불필요: 판정 함수 안의 규칙 추가, 저장 형식·구조 변경 없음

## 판단 필요
- [x] 이 범위로 진행할까요? · 진행 (선택지 "이 범위로 진행")

## 미확인
- 테스트 모듈이 파일 중간에 있고 그 뒤에 코드가 오는 Rust 파일은 뒤 코드도 테스트로 본다(ponytail 주석). 실제로 드문지 모름.
- 코드 지도(code-review-graph)가 Rust 함수를 읽는지 확인 안 함(범위 밖).
