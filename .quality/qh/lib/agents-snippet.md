## Quality gate (qh) (품질 게이트)

`qh` means `node .quality/qh/bin/qh.js` (run from the repository root).

- Talk to the person in the language they write in. Never switch to English with them, even though these rules are English.
- Before ending a response, run the needed checks with `qh check`. "It passed" is not evidence. Only the state `qh status` shows is evidence.
- In the task card `.quality/tasks/<branch>.md`, write the desired outcome, success conditions → checks, `판단 필요` (what the person must decide), and `미확인` (unverified). Under `## 판단 필요`, write `- [ ] question` as a question the user can read and answer as is (qh reads only this shape as a user confirmation and shows the line to the user as it is). When the user answers, write `- [x] question · answer`; when there is nothing to decide, write `- 없음`.
- Before writing a new function or component, search the code map for something similar: `code-review-graph search <keyword> --kind Function` (or the code-review-graph MCP). Search 2-3 times with English words for what it does (e.g. `date validation`, `date`). Korean words or invented function names find nothing. If a match exists, reuse it.
- Before changing a function other code uses, list its callers with `code-review-graph query callers_of <file>::<function>`, and check them after the change (read only the file list). To find where a feature lives, grep paths and strings (the map knows only function and test names).
- When qh shows `중복` (blocking), reuse the existing location it names or merge into one place. Do not fix a `중복(원래 있던 것)` warning in this task. Refactors happen outside the red→green loop, only what the person picks in the architecture check (ADR 0001).
- Before changing code, write a failing test first. If a change needs no test, doc, or ADR, write one line each in the task card giving the reason: `테스트 불필요: <why no test is needed, 5+ chars>`, `문서 영향 없음: <why docs need no change, 5+ chars>`, `ADR 불필요: <why no design record is needed, 5+ chars>`.
- Record decisions as one line in `docs/decisions.md` (date · decision · reason · when to revisit). Write structural or risky decisions in docs/adr/NNNN-title.md (decision, reason, rejected alternatives) and link it.
- Never put secrets (keys, tokens, passwords) in code or docs. Take them from environment variables.
- Never log personal data (email, phone number, etc.). When you change external-integration code, also write a test for when the other side fails (timeout, 5xx).
- Read `.quality/qh/lib/ask-guide.md` and follow it for questions (project question session, task questions). The user picks the answer. The agent never picks for them.
- Ask questions with choices through the AskUserQuestion tool in Claude Code (the user picks with the arrow keys; put the recommended option first). Without that tool (Kiro and others) or with more than 4 choices, ask in chat and number the choices.
- Write the decision-log allow lines (`큰 파일 허용`·`중복 허용`·`루트 파일`·`문서 증가 허용`·`기존 실패 허용`) only after asking the user and getting an answer. Do not cram code into one line to dodge a limit.
- In what you say to the user (questions, final report), do not use file paths, commands, check names, or commit hashes. Say in words what changed and what the user must decide. Pass on the sentence qh gives after "Tell the user:" as it is. Exception: the user said they are a developer.
- Never change `.quality/config.json`, `.quality/access.json` (the permission table), or `.quality/probe.mjs` without asking the user. Do not lower a standard to make a check pass.
- When qh says `환경 오류`, do not change code; report it to the user as it is.
- Run `qh pr` before opening a PR.
- When the user wants a quality report, run `qh measure` (for "also measure the last N weeks", run `qh measure --backfill N`) and open the printed report file in the browser (macOS `open`). Past reports are in `.quality/reports/`.
