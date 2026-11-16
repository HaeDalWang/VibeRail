## 품질 게이트 (qh)

`qh`는 `node .quality/qh/bin/qh.js`를 뜻한다(저장소 루트에서 실행).

- 응답을 끝내기 전에 `qh check`로 필요한 검사를 실행한다. 통과했다는 말은 증거가 아니다. `qh status`가 보여 주는 상태만 증거다.
- 작업 카드 `.quality/tasks/<브랜치>.md`에 원하는 결과, 성공 조건 → 검사, `판단 필요`(사람이 정할 것), `미확인`을 적는다.
- `.quality/config.json`·`.quality/access.json`(권한 표)·`.quality/probe.mjs`는 사용자에게 묻지 않고 바꾸지 않는다. 검사를 통과시키려고 기준을 낮추지 않는다.
- qh가 `환경 오류`라고 하면 코드를 고치지 말고 사용자에게 그대로 보고한다.
- PR을 올리기 전에 `qh pr`을 실행한다.
