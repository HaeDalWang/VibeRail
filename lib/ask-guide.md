# qh question guide (for agents)

`qh` is `node .quality/qh/bin/qh.js`. The user picks the answer. The agent never picks for them or makes one up.

## Project question session (프로젝트 질문 세션)

When: tell the user when `qh doctor` or session start says "프로젝트 질문에 아직 답하지 않았다". Open the session when the user wants it (e.g. "품질 기준을 같이 정하자") or when the product's nature changed (login, personal data, DB, external integration, or deployment newly appeared).

1. Run `qh ask`, then open it for the person (macOS `open`, Linux `xdg-open`) with the path printed after `질문 화면:`. Say in one plain line that the question page is open. The page exists only on this computer. Upload it nowhere.
2. Pass the `qh 답` block the user pasted via "프롬프트 복사" through unchanged:
   ```sh
   node .quality/qh/bin/qh.js answer <<'QH'
   (pasted block)
   QH
   ```
3. If the output says `저장하지 않음:`, show that line to the user and have them choose again on the page. Never edit the block yourself.
4. When saved, run `qh doctor`. If it prints a `[실패]` saying something the answers require (a check, risk area, or doc) is missing, translate each doctor failure into one plain sentence (what is missing and what it would protect, with no file names, keys or commands) and ask the user what to do. Do not change `.quality/config.json` without the user's confirmation.

## Task question (작업 질문)

When: at the end of a response, qh shows `작업 질문(<위험 영역>, …)`, meaning this task touched a risk area.

- Ask briefly. Use qh's question sentence and A/B options as they are, and add the changed files in one line.
- Only after the answer, write `작업 질문 <위험 영역>: A 사유` or `B 사유` in the task card.
- If A (there is a change), that task must have an ADR. `ADR 불필요` does not apply.

## Standard confirmation (기준 확인)

When: qh shows `기준 변경(사람 확인 필요)`. The quality-check settings were newly created or changed.

- Do not show file names, JSON, or commit hashes. Explain in words qh's summary (checks turned on, risk areas, number of paths in the permission table) or what changed, and ask "이대로 쓸까요?".
- Only after the user says yes, run `node .quality/qh/bin/qh.js confirm`. It is recorded bound to the current settings, so qh asks again if the settings change.
- If no, ask what they want to change. Edit the settings file only after getting that answer.

## Allowing an existing failure (기존 실패 허용)

When: a check fails regardless of this task, and fails for the same reason on the base branch.

- Fix it if you can. If you cannot, ask the user: "이 검사는 이 작업 전부터 실패합니다. 따로 고칠 일로 두고 이번에는 막지 않을까요?"
- Only after asking, and only if the user says yes, write one line in `docs/decisions.md`: `- 날짜 · 기존 실패 허용: <검사 이름> · <user's answer and reason, 5+ chars> · 고쳐지면`. Never write it without asking.
- That check's failure then shows only as a warning. When it is fixed, delete the line.

## Allow lines (허용 줄)

When: qh shows `큰 파일`·`중복`·`루트 파일`·`정리 대상 폴더`·`문서 증가`, and fixing it (splitting, merging, moving) would make things worse.

- Fix it first. Do not merge lines or cram code to dodge a limit.
- If you cannot fix it, ask the user in plain words why it cannot be split: "이 파일은 ○○ 때문에 나누면 더 복잡해집니다. 이번에는 길이 한도의 예외로 둘까요?"
- Write the `큰 파일 허용`·`중복 허용`·`루트 파일`·`문서 증가 허용` lines to `docs/decisions.md` only after asking the user and getting an answer. Never write them without asking. Include the user's answer in the reason.

## Filling in how to run the app (앱 실행 방법 채우기)

When: qh tells you to ask the person about an empty part (todo) of `.quality/probe.mjs`.

- Ask whether you may fill it using the sentence qh gives after "Tell the user:". Only after permission, fill `.quality/probe.mjs` (build the app, login, test DB). If not, decide together whether to turn that check off; remove it from `.quality/config.json` only after getting an answer.

## When the agent writes its own question

When the user must decide something qh's questions do not cover, ask in the same shape.

- Name options as nouns or states, not verbs: "DB 변경 있음 / 없음", "운영 배포 대상 / 제외", "개인정보 취급함 / 취급 안 함", "외부 API 연동 있음 / 단독 실행", "팀 협업 개발 / 단독 작업", "리뷰 적용 / 리뷰 생략".
- For each option write three things: how it works (what turns on), the benefit, the cost / risk.
- Attach one recommendation and its basis (what you saw in the repo). If the basis is a guess, say it is a guess.
- Ask one decision at a time. If the user picks differently from the recommendation, get a one-line reason. Record that decision as one line in `docs/decisions.md`.

## Adding a check (검사 넣기)

When: the project now has a test or lint command that is not in `checks` of `.quality/config.json`.

- Ask the user in words: "테스트를 만들 때마다 자동으로 돌려 확인할까요? 전체는 올리기 직전에만 돌리고, 평소에는 바뀐 부분 테스트만 돌립니다."
- Add to `checks` only after they say yes (with this project's own commands). `{tests}` is filled with the test files changed in this task; with nothing to run, the check is skipped:
  ```json
  "test": { "cmd": "npm test", "on": ["pr"] },
  "test-work": { "cmd": "npm test -- {tests}", "on": ["stop"] }
  ```
- If qh then shows `기준 변경(사람 확인 필요)`, confirm once more as in "Standard confirmation" above.
