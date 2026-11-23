**Status:** ready-for-agent

# Spec: the finished-work review page, in reading order

## Problem Statement

At ◆③ the person is asked to check the interface and the tests, but what they get is the agent's chat summary or the whole diff. The pieces they need are scattered: the goal is in the task card, the picked option and its picture are in the design JSON, the test results are in the test log, the review findings are in the review evidence, and the open questions are back in the card. A non-developer cannot assemble these, and an agent summary can drift from what the records say.

## Solution

When `qh review` finishes, qh also writes one local HTML page that lays the existing records out in reading order: what changed → the picked option → test evidence per success condition → review findings → what is left to decide. Nothing on the page is written by an AI; every item is copied from a record and names its source. The agent opens the page for the person (same way as the design pages). When the person chose "검토 생략" (reviewer C), the page is still written, with the findings step saying the review was skipped.

## User Stories

1. As a person at ◆③, I want one page that reads top to bottom in a fixed order, so that I do not have to know where each record lives.
2. As a person, I want the first step to show the card's goal, the commit messages since the branch started, and the list of changed files, so that I know what this work was for and what it touched.
3. As a person, I want the picked option's name and my own reason shown again, so that I can check the result against what I chose.
4. As a person, I want the picked option's picture, gain and cost shown again when the design file still has that option, so that I see the same picture I picked from.
5. As a person, I want the page to fall back to the card's text when the design file or the option is gone, so that the page is still made.
6. As a person, I want each success condition shown with 통과 / 실패 / 찾지 못함, so that I see which promises the tests back.
7. As a person, I want a warning when the test record is older than the current code, so that I do not trust a stale pass.
8. As a person, I want a warning when there is no test record at all, so that every condition does not silently read 찾지 못함.
9. As a person, I want the review findings listed with severity, file and line, reason and next action, so that I see what the reviewer flagged.
10. As a person, I want "지적 없음" when the review found nothing, so that an empty step is not mistaken for a broken page.
11. As a person who chose 검토 생략, I want the page anyway with the findings step saying the review was skipped, so that I still get the reading order.
12. As a person, I want the open `- [ ]` questions from 판단 필요 and the 미확인 lines shown last, so that I know what is still mine to decide.
13. As a person, I want every item to name its source (card section, commit, test log, review result, design file), so that I can trust nothing was invented.
14. As a person on level A, I want plain Korean labels and no developer details; on level B I also see file paths and test names, so that the page matches my level like the design pages.
15. As a person, I want everything escaped, so that text in commits, cards or findings cannot break the page.
16. As a person, I want the page to load nothing from the network except what the design pages already load for pictures, so that it works the same way they do.
17. As an agent, I want `qh review` to print where the page is and to tell me to open it, so that I do not have to remember.
18. As an agent, I want the page written only on a successful review run or on the skip path, never on an environment error, so that a broken review does not leave a page claiming success.
19. As an agent, I want the page to overwrite the previous one, so that only the latest review is shown.
20. As an agent, I want a missing card, missing sections or a missing test log to produce a page with "기록 없음" in that step rather than an error, so that the review command never fails because of the page.
21. As an agent, I want success condition lines whose test name is cut with "…" to match on the part before "…", so that shortened names still find their test.
22. As an agent, I want the qh-cycle ◆③ row to say the page exists and to open it, so that the step uses it every time.

## Implementation Decisions

- Picked interface: option A ("한 함수가 모으고 그림"). A new module exposes `writeReviewPage(root, { base, treeHash, findings | null })` → page path. `findings === null` means the review was skipped. `qh review` calls it with one line at the end of the success path and in the skip path. The 784-line CLI file gets only those calls and the printed line.
- The page goes to the reports folder as `review.html`, next to the other `qh view` pages.
- The module reuses the design-page shell, style, picture drawing and escaping from the view module; the view module exports what is needed instead of copying it.
- Step contents and sources:
  1. 무엇이 바뀜 — card `## 의도`; commit subjects `base..HEAD`; changed file names `base` → tree.
  2. 고른 안 — card `## interface 결정` (안, 이유). If a `설계안: <path>` line exists and the JSON there has an option whose id matches the 안 line's id, show its picture, gain and cost (and signature/seam on level B).
  3. 테스트 증거 — each line of `## 성공 조건 → 검사` of the form `- <desc> → <file> "<test name>"`. The quoted name (prefix before "…" if cut) is looked up in the last test log: a ✔ line → 통과, a ✖ line → 실패, neither → 찾지 못함. Lines without a quoted test name show the line as written with 찾지 못함. The test evidence's tree hash differing from the current one shows the stale warning.
  4. 리뷰 지적 — the findings, ranked as given; empty → 지적 없음; null → 검토 생략.
  5. 남은 판단 — unchecked `- [ ]` lines from `## 판단 필요`, and `## 미확인` lines.
- Card reading uses the existing card section parser; the card is the branch's task card.
- The page is level-aware the same way the design pages are (level from config answers).
- The page has no buttons and no copy flow; it is read-only.

## Testing Decisions

- Seam: `qh review` run end to end in a temp repo with a fake review command (writes a fixed result), then read the written page. One seam, the one agreed on the card.
- Test external behaviour only: the order of the five steps in the HTML, the test-evidence states (통과 / 실패 / 찾지 못함 / stale / no record), the picked option's picture present or the text fallback, findings / 지적 없음 / 검토 생략, open questions shown, escaping, and that an environment error writes no page.
- Prior art: the PR-gate tests' installed-repo fixture and fake review command that writes an empty result; the view tests for reading page HTML.

## Out of Scope

- AI-written summaries or explanations.
- Detecting whether the design file changed since the pick (backlog item 3).
- Comments on the page or sending answers back (backlog items 4 and 5).
- Showing the diff itself.
- A check that every success condition has a passing test.

## Further Notes

- Source idea: plannotator Guided Review (backlog item 2).
- Because the branches stack, "changed since base" includes the parent branches' work until they merge; the page shows what `qh review` reviewed, which has the same scope.
