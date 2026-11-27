# Spec: spec check (명세 대조) before loop start

## Problem Statement

After grilling and the interface pick, the person asks for a spec ("명세 만들어 줘") and tickets ("작업 나눠 줘"), then approves the loop with "돌려". They cannot tell whether the spec and tickets are any good: the spec is a long English document, the tickets carry developer acceptance criteria, and upstream to-tickets asks developer questions (too coarse or too fine, blocking edges right). In practice the person passes them without reading ("어차피 지금 나 스스로가 그냥 넘기고 있드라구"). That is the rubber-stamp approval ADR 0001 warns about: nothing checks that what the person said made it into the work, or that each ticket ends in something the person can see.

## Solution

The judgment moves to the machine. Once the card lists tickets, qh runs a spec check (명세 대조) before it asks "돌려":

1. Shape rules (code, every `qh check` and Stop): every ticket file the card links exists, has at least one acceptance box, and its blockers name tickets that exist.
2. Meaning check (AI): qh writes a task for a fresh sub-agent that did not write the spec. It compares the whole task card (intent and scope, success conditions, answered `판단 필요` lines, the picked option and its reason) against the spec and the tickets' acceptance criteria and reports missing items (빠진 말), unrequested items (끼어든 말) and tickets with no visible result (끝나면 볼 것). qh validates the result file and records it, bound to the content it checked.

Missing items and tickets with no visible result are the agent's to fix: it edits the spec or tickets and checks again, at most 2 rounds. What remains after that, and every unrequested item, becomes a one-line question to the person. Only when the check passes for the current content does qh ask the spec confirmation ("명세(확인 번호 …)대로 작업을 시작할까요?"). The loop-start summary gets one line with the result.

## User Stories

1. As a person, I want the machine to check that everything I said in grilling is in the spec or a ticket, so that I do not have to read an English spec to find gaps.
2. As a person, I want the success conditions on my card checked against the tickets' acceptance criteria, so that "done" means what I agreed.
3. As a person, I want my answered `판단 필요` lines and my reason for the picked option used as part of what I said, so that small decisions from grilling are not lost.
4. As a person, I want every ticket to end in something I can see (a screen, an output, a file), so that I can tell when a ticket really finished.
5. As a person, I want the agent to fix missing items itself and check again, so that I am asked only about what needs me.
6. As a person, I want at most 2 fix-and-recheck rounds before remaining gaps come to me, so that cost does not run away and a wrong fixing direction surfaces early.
7. As a person, I want each unrequested item asked as one line ("명세에 'OO'가 들어갔습니다. 원하신 건가요?"), so that only I decide whether something extra stays.
8. As a person, I want a "no" on an unrequested item to make the agent remove it and check again, so that my answer has effect.
9. As a person, I want no "돌려" question before the check passes for the current content, so that I never approve unchecked work.
10. As a person, I want the check to run again when the spec, a ticket or the card changes after it passed, so that an approval stays bound to what was checked.
11. As a person, I want my answers to unrequested items kept when the check runs again, so that I am not asked the same line twice.
12. As a person, I want the loop-start summary to carry one line with the result ("명세 대조: 말한 것 N개 모두 들어감, 작업마다 끝나면 볼 것 있음"), so that I see the machine looked.
13. As a person, I want the to-tickets breakdown question to tell me that the machine checks after the files are written, so that I can answer it without judging granularity myself.
14. As a person, I want the completion review page to say the meaning check was run by a sub-agent the agent declared, not one qh verified, so that I know the limit of the evidence.
15. As an agent, I want shape problems listed in the normal `qh check` output with what to fix, so that I fix them as I write the tickets.
16. As an agent, I want one command that writes the sub-agent task and one that validates and records its result, so that I do not assemble inputs by hand.
17. As an agent on Claude Code or Kiro, I want the task to tell me how to start a fresh sub-agent on my host and to pass it only the task, so that the checker does not see my reasoning.
18. As an agent, I want a malformed result file refused with the reason, so that a broken check never counts as a pass.
19. As a person on a card without tickets (small fix, `grilling 불필요`), I want nothing to change, so that the check costs nothing there.

## Implementation Decisions

- The picked option is B ("있는 흐름에 나눠 얹기", 확인 번호 2521): qh does not launch the meaning check; the agent starts a sub-agent with qh's task and qh validates the result. Reason given: speed. This replaces the grilling scope's "the AI uses the configured review command": with B the meaning check does not run through the review command.
- New module: spec check. Interface: `qh spec-check --task` writes the task file for the sub-agent (inputs: card, spec and the card's ticket files, all relative paths; output: the result path) and prints how to run it; `qh spec-check --result [file]` validates the result and records it as evidence under the evidence directory (not committed).
- Result shape (JSON): `{ "missing": [{ "from": "<card line or section>", "text": "<Korean one line>" }], "extra": [{ "where": "<spec or ticket location>", "text": "<Korean one line>" }], "noVisible": [{ "ticket": "<ticket path>", "text": "<Korean one line>" }] }`. All three arrays required; empty arrays mean pass on that axis. Anything else is refused.
- The record holds: the content number (same 4-digit confirmation number scheme as 확인 번호, over the card's checked sections, the spec and every linked ticket file, whitespace ignored), the result, the round count, and `checker: agent-declared`.
- Round counting: a recorded result with missing items or tickets with no visible result counts one round for its card. A pass starts the count again (review answer "통과하면 새로").
- `--task` on a card that links no ticket files writes no task and stops with a message (review answer "멈추게 하기"). After 2 such rounds, the remaining items become person questions instead of agent instructions.
- Gate: the existing spec confirmation (loop start) is preceded by the spec check items in the same blocking question list (waivers/confirms):
  - no record for the current content number → agent item: run `qh spec-check --task`, then the sub-agent, then `--result`;
  - missing / noVisible within 2 rounds → agent item: fix spec or tickets, rerun;
  - after 2 rounds → person question per remaining item: missing "작업 카드의 'OO'가 명세·작업에 없습니다. 빼고 진행할까요?", noVisible "작업 'NN'은 끝나도 확인할 것이 없습니다. 그대로 진행할까요?";
  - extra → person question "명세에 'OO'가 들어갔습니다. 원하신 건가요?"; a non-yes answer tells the agent to remove it.
  - Answers are card lines `- [x] <question> · <answer>` (the existing decision format) and are matched by question text, so they survive reruns.
  - Only when none remain is "명세(확인 번호 …)대로 작업을 시작할까요?" asked.
- Shape rules join the policy problems of `assess` (no config change, no new built-in check entry): for cards that link ticket files.
- qh-cycle skill (ours, not vendored): step 3 says to announce the machine check when answering the to-tickets breakdown question, and to run the spec check after the ticket files are written; ◆ Loop start's summary carries the result line. Vendored to-spec / to-tickets stay unedited.
- The task file states: fresh sub-agent (Claude Code: Agent tool; Kiro: its sub-agent), pass only the task path, do not pass the spec author's explanation; read only inside the working directory; write only the result file.
- The completion review page shows one line for the spec check: result and "검사자: 에이전트 신고(기계 확인 아님)".

## Testing Decisions

- Test only behaviour visible at the two agreed seams; internals (number computation, rule details) may change without breaking tests.
- Seam 1, the spec-check command (`test/spec-check.test.js`): `--task` writes a task naming the card, spec and tickets and the result path; `--result` accepts a well-formed file and records it, refuses a malformed one with the reason and records nothing.
- Seam 2, the pending question list (`test/confirm.test.js`): with tickets and no record, the spec confirmation is absent and an agent item to run the check is present; a shape problem (ticket with no acceptance box, missing blocker) shows as a policy problem; a pass for the current content brings the spec confirmation; changed content brings the agent item back; unrequested items become person questions and answered ones do not return; after 2 failing rounds missing items become person questions; a card without tickets gets nothing.
- Seam 3, the completion review page (`test/review-page.test.js`, added by the person's answer "완료 리뷰 화면 더하기"): the spec check line with the checker limit when a record exists, nothing when none.
- Prior art: `test/confirm.test.js` (confirmation numbers bound to content, questions from the card), `test/pr-gate.test.js` (fake review command writing result.json).

## Out of Scope

- The person still starts the spec and the tickets in words ("명세 만들어 줘", "작업 나눠 줘"); see the 2026-11-19 concern.
- qh launching the meaning check itself (option A).
- Verifying that the checker was a fresh sub-agent: accepted as a gap and shown on the review page.
- Judging ticket granularity or vertical slicing beyond the shape rules.

## Further Notes

- Glossary terms: 명세 대조, 빠진 말, 끼어든 말, 끝나면 볼 것 (GLOSSARY.md).
- Docs to update: reference (new command, the gate), decision log line.
