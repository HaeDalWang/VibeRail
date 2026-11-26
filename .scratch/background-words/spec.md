**Status:** ready-for-agent

# Spec: the person's background and word list (단어집)

## Problem Statement

The only knob for how the agent talks to the person is the level answer: developer (B) or not (A). On A, every word is pushed down to "easy" words. For an engineer who is not a developer (the target, ADR 0003) that often reads worse, not better: generic easy words drop the precise terms of their own field. The agent has no record of who the person is, so it cannot pick words from their field, and nothing carries such words across sessions.

## Solution

The project question page gets one free-text box under the level question: what the person does and their background. Pasting the copied answers makes qh write it to a per-person file that never leaves the computer (`.quality/me.md`, gitignored). The same file holds the word list (단어집): a table from development words to the person's field words. At every session start qh adds one line for the agent: background with no word list → draft about ten rows before the first grilling and show them once; word list present → speak with it. A and B stay; they decide only how much detail is shown. qh never judges the word list.

## User Stories

1. As a person on the question page, I want a box under "개발에 얼마나 익숙하세요?" for what I do and my background, so that the agent can speak in my field's words.
2. As a person, I want leaving the box empty to change nothing, so that the feature costs me nothing if I skip it.
3. As a person who installed before this feature, I want reopening the question page to show the box with my other answers kept, so that I can add a background later.
4. As a person reopening the page, I want the box to show the background I wrote before, so that I edit rather than retype.
5. As a person, I want my background stored only on my computer and never committed, so that my job and history do not end up in a (possibly public) repository.
6. As a teammate, I want my own background and word list, so that one person's words are not forced on the team.
7. As a person, I want saving a new background to keep the word list I already have, so that corrections I made are not lost.
8. As a person, I want my background never written to the decision log, so that personal details do not land in a committed file.
9. As a developer (B), I want the same box and word list, so that field differences (data, infra) are covered for me too.
10. As a person with a background and no word list, I want the agent to draft about ten rows before the first grilling and show them to me once, so that the first questions already use my words.
11. As a person, I want the draft used right away without an approval question, so that grilling is not held up.
12. As a person, I want to say "이 말 모르겠다" and have that word added as one row, so that the list grows where I actually stumble.
13. As a person, I want to fix a wrong row by saying so or by editing the file, so that I stay in control of my words.
14. As a person, I want a development word with no good match in my field kept as is with a short gloss in brackets, so that a forced analogy does not change the meaning.
15. As a person, I want the word list used in everything the agent writes to me (grilling questions and choices, the design and architecture pages, the final report), so that the words are the same everywhere.
16. As a person, I want qh's own fixed sentences left as they are, so that check messages stay exact.
17. As a person, I want words that are in the project glossary (GLOSSARY.md) never replaced by the word list, so that project terms stay one name.
18. As an agent, I want one session-start line telling me whether a word list exists and what to do, so that I do not depend on remembering a rule.
19. As an agent, I want no line at all when there is no background and no word list, so that projects without it see nothing new.
20. As an agent, I want qh answer to accept a block that only changes the background, so that updating it does not need a level answer.
21. As a person in an old install whose .gitignore lacks the file, I want qh to add the ignore line before it writes my background, so that it can never be committed by accident.

## Implementation Decisions

- **One per-person file**: `.quality/me.md`, Markdown so the person can edit it. Shape:
  ```md
  # 나 (이 컴퓨터에만 · 저장소에 올리지 않음)

  ## 배경
  <one paragraph>

  ## 단어집
  | 개발 말 | 내 말 |
  |---|---|
  ```
  qh writes only the `## 배경` body; it creates the file (with an empty 단어집 table) when missing and keeps every other part verbatim.
- **Question page**: the level card gets a second textarea, "하는 일·배경 (선택, 이 컴퓨터에만 저장)", prefilled from the file's 배경. The copied block gains `배경: <text>` (whitespace collapsed) only when the box is non-empty.
- **qh answer**: accepts the `배경:` line in the block. A block with only that line is valid (no "답이 없다" error). Background is not a config answer, is not a criteria change, and writes no decision-log line. An empty or missing `배경:` line leaves the file alone. A length cap guards the input (a fixed policy limit, about 500 characters; longer is refused with the limit named, like the reason check).
- **gitignore at the trust boundary**: `qh init` adds `.quality/me.md` to the ignored list; `qh answer` also appends it to `.gitignore` before writing, if missing.
- **Session-start line** (`wordsLine(root)`, agent-facing English like the other session-start lines; shown in every project, not only qh-cycle ones):
  - no file, or empty 배경 and no table rows → no line;
  - 배경 and no rows → draft about ten rows of the development words this cycle uses most, in the person's field, into the 단어집 table; show them once; use them;
  - rows present → speak to the person with the word list; development words with no match stay as is plus a short gloss in brackets; add a row when the person says a word was unclear; never replace GLOSSARY.md terms.
- **Rules**: one line in the agent rule block (agents-snippet) and the "Talking to the person" part of qh-cycle: level A no longer means "only easy words" but "word list words where they exist". Vendored skills are untouched.
- No check, doctor item or review finding for the word list.

## Testing Decisions

- Test only through the CLI, as the existing tests do (`qh answer` with a piped block, `qh hook session-start`, `qh init` on a temp repo); assert files and stdout, not internals.
- Seams (agreed on the design page): `test/criteria-answers.test.js` for qh answer and the file; `test/cycle-policy.test.js` for the session-start line; `test/init-gitignore.test.js` for the ignore line.
- Cases: background-only block saves and keeps the existing 단어집 and makes no criteria change and no decision-log line; reopened page prefilled; too long refused; old install gets the ignore line before the write; session-start line in each of the three states, also in a project without the qh-cycle skill.
- Prior art: the existing answer tests in `test/criteria-answers.test.js`, the SessionStart test in `test/cycle-policy.test.js`, the init gitignore test.

## Out of Scope

- Rewriting qh's fixed sentences with the word list.
- Judging whether the word list is good, or checking that the agent used it.
- A team-shared word list.
- Asking for the background in chat when the box is empty.

## Further Notes

- Grilling 2026-11-26, design pick A (확인 번호 3983): "컨텍스트가 커지지만 무조건 우선 들어간다는 점에서 선택".
- Background is personal data in the AGENTS.md sense: it is never logged, never put in the decision log, and never sent anywhere.
