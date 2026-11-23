**Status:** ready-for-agent

# Spec: one reader for the task card's 판단 필요 section

## Problem Statement

The task card's `## 판단 필요` section is how the person's decisions reach qh: `- [ ] question` is open (the PR gate and the Stop hook block on it), `- [x] question · answer` is answered (a waiver, a criteria confirmation or a confirmation number counts only through such a line). Five places read this section, each with its own parsing, and they disagree. Found by running a test card through the current code:

- An indented `- [ ] question` is an open question to the waiver check, but the PR gate's open-question list misses it, so a PR passes with a question the person never answered.
- `- [X] question · answer` passes the format check as a checked line, but the answer check accepts only lower-case `x`, so the same question is asked again forever.
- `* [ ] question` and `+ [ ] question` pass the format check, but neither the PR gate nor the waiver check sees them.
- One reader takes only the heading exactly `판단 필요` and drops HTML comments; another takes any heading that starts with `판단 필요` and keeps comments.

The person (architecture check 2026-11-23, candidate 1): "어긋나는 걸 줄이는 게 제일 급하다".

## Solution

One module reads the section with one lenient rule, and the five places only call it. Whatever the person or agent writes that is a checkbox list line in that section is read the same way everywhere: open questions block in the PR gate and the Stop hook alike, answered lines settle a waiver or a confirmation whatever the case of `x`, and the format check flags exactly the lines the others would not read as a question or an answer.

## User Stories

1. As a person, I want an indented `- [ ] question` to block the PR like any other open question, so that a question I never answered cannot slip through.
2. As a person, I want `- [X] question · answer` to count as my answer, so that I am not asked the same question again.
3. As a person, I want `* [ ]` and `+ [ ]` lines read like `- [ ]` lines, since Markdown treats them as the same list, so that the list marker an agent happens to use changes nothing.
4. As a person, I want only the section headed exactly `판단 필요` read, so that a section such as `## 판단 필요 메모` does not add or hide questions.
5. As a person, I want questions inside HTML comments ignored everywhere, so that a commented-out example is never a real question.
6. As a person, I want the review page's "what is left" step to list the same open questions the PR gate blocks on, so that what I see matches what qh enforces.
7. As a person, I want an indented note without a checkbox under a question to stay a note (not a format problem), so that explaining a question does not trip a check.
8. As an agent, I want a top-level list item without a checkbox still flagged by the format check (except "없음"-style lines), so that a decision written in the wrong shape is caught.
9. As an agent, I want a waiver, a criteria confirmation and a confirmation number to be settled by the same "answered" rule (checked, the question, then ` · ` and a non-empty answer), so that they cannot drift apart.
10. As an agent, I want a checked line with no answer to keep counting as unanswered (no new message), so that this refactor adds no new check.
11. As a maintainer, I want the section's rules in one module with one test file, so that the next rule change happens once.

## Implementation Decisions

- Picked interface: option B ("질문과 답까지 읽어 주는 모듈", 확인 번호 9954), reason "어긋남을 줄이는것이 크다". It lives in the existing card module (pure card parsing); no new file.
- Module interface:
  - `SECTIONS.decisions = '판단 필요'` next to the existing section names.
  - `decisions(card) → { open: [question], plain: [text], answered: [text] }`
    - Reads `section(card, SECTIONS.decisions)`: exact heading, HTML comments removed (the existing section reader's rule).
    - A line is a checkbox line when, after optional leading whitespace, it is `[-*+]`, whitespace, `[ ]` / `[x]` / `[X]`, whitespace, text. Indentation does not matter.
    - `open`: the text of `[ ]` lines, trimmed.
    - `answered`: the text of `[x]`/`[X]` lines (the whole `question · answer`), trimmed, whether or not it has an answer; callers that need an answer use `answerState` or check for ` · `.
    - `plain`: the text of top-level (unindented) list items without a checkbox, trimmed, minus "nothing" lines (없음 / 없다 / none / n/a, optional parentheses and period). Indented items without a checkbox are notes and are dropped.
  - `answerState(card, question) → 'yes' | 'open' | 'none'`: moved from the waivers module with the same name and meaning. 'yes' when an answered text starts with `question ·` and has non-empty text after it; else 'open' when `open` holds exactly `question`; else 'none'.
- Callers (behaviour otherwise unchanged):
  - PR gate open-question list = `decisions(card).open`.
  - Format check = `decisions(card).plain` (same message).
  - Waiver and criteria/answer-change checks call `answerState` from the card module; the waivers module stops exporting it.
  - Confirmation numbers: approved numbers come from `decisions(card).answered` filtered by the head and ` · \S`; the open-question filter uses `decisions(card).open`.
  - Review page "what is left" uses `decisions(card).open`.
  - The private line splitters these callers had for this section go away (the review page and the confirm module keep their own splitter for other sections).
- The guidance sentences that tell the agent to write `- [x] question · answer` stay where they are (the format is unchanged).

## Testing Decisions

- A good test feeds a card text to the module and checks what it returns; it does not look at regexes or helper functions.
- Seam: the card module's test file only. One test per drift: indented question is open; `[X]` answers; `*`/`+` markers; exact heading only (a `판단 필요 메모` section adds nothing); commented questions ignored; indented note without checkbox is not plain; top-level plain item and "없음" handling; `answerState` yes/open/none including an answer-less checked line.
- The five callers are covered by the existing tests (stop hook, PR gate, waivers, confirm, review page, user-facing messages); they must pass unchanged except for imports of `answerState`.
- Prior art: the existing section-reader tests in the card test file.

## Out of Scope

- The duplicated "intent section is empty" judgement (architecture candidate 2).
- Collecting the guidance sentences about the `- [x] question · answer` format.
- A new message for a checked line with no answer.
- Changing how confirmation numbers or waivers decide what to ask.

## Further Notes

- The main CLI file is near its 800-line limit; this change should shrink it (two helpers and a regex go to the card module).
- The vendored copy under `.quality/qh/` is refreshed only after the change is committed (dev-repo rule).
