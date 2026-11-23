# 01: Review page skeleton written by qh review

**What to build:** After a successful `qh review`, and on the 검토 생략 (reviewer C) path, qh writes the review page in the reports folder and prints where it is, telling the agent to open it. The page shows its five steps in order; this ticket fills step 1 (card 의도, commit subjects since base, changed file names), step 4 (findings with severity, file:line, reason, next action; 지적 없음 when empty; 검토 생략 when skipped) and step 5 (open `- [ ]` lines of 판단 필요 and 미확인 lines). Steps 2 and 3 show "기록 없음" for now. Every item names its source; everything is escaped; a missing card or section gives "기록 없음" in that step, never an error. An environment error in the review writes no page. The view module exports the shell, style and escaping it needs instead of copying them. The qh-cycle ◆③ row and the reference doc mention the page.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] A successful review writes the page and prints its location with an "open it" line
- [x] The skip path writes the page with 검토 생략 in the findings step
- [x] Steps appear in the fixed order with their sources; card, commit and finding text is escaped
- [x] Findings / 지적 없음 / open questions and 미확인 render from the records
- [x] A missing card gives 기록 없음, not an error; an environment error writes no page
- [x] Skill ◆③ row and reference doc updated; existing tests still pass
