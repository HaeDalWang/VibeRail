**Status:** ready-for-agent

# Spec: questions beside the options on the decision pages

## Problem Statement

On the interface page and the architecture-check page the person picks an option and writes a reason. Decisions that hang on the pick (for example "keep the old format readable?" only matters for option B) are asked separately in chat, away from the picture that explains them. The person has to hold the option in their head while answering, and the agent has to remember which answer belongs to which option.

## Solution

The agent may attach single-choice questions to the page as a whole (common questions, shown once at the top) and to individual options or candidates (shown inside that option's card). Each question shows 2–4 choices, marks the recommended one, and always offers "기타" with a free-text box. When the person presses the pick button, the copied text carries the pick, the reason, and one card-ready line per answered question: `- [x] <question text> · <answer>`. Copy is refused, naming the missing questions, when a common question or a question of the picked option is unanswered. Questions of other options are ignored.

Because the card line repeats the question text, a question whose wording changed no longer matches an old answer line, so it is asked again (the risk named in the backlog).

## User Stories

1. As a person choosing an interface, I want questions about option B shown inside B's card, so that I answer them while looking at B's picture.
2. As a person, I want questions that matter whichever option I pick shown once at the top, so that I am not asked the same thing per option.
3. As a person, I want the recommended choice marked, so that I can accept it quickly when I have no opinion.
4. As a person, I want a "기타" choice with a text box, so that I am not forced into choices that do not fit.
5. As a person, I want the copy button to refuse and name the unanswered questions, so that I do not paste half a decision.
6. As a person, I want questions of options I did not pick to be ignored, so that I only answer what my pick needs.
7. As a person, I want the copied text to contain my answers as plain lines, so that I can read what I am pasting.
8. As a person, I may still answer in chat instead of copying, as the page already says.
9. As an agent, I want each answer as `- [x] <question> · <answer>`, so that I write it under `## 판단 필요` unchanged.
10. As an agent, I want `qh view` to reject a malformed question (missing text, fewer than 2 or more than 4 choices, recommended not among the choices, text with a line break, the same text twice in one scope), so that the page never shows a broken question.
11. As an agent, I want the same questions feature on the architecture-check page, so that both decision pages work the same way.
12. As an agent, I want pages without any questions to look and copy exactly as today, so that existing JSON keeps working.
13. As a person on level A or B, I want the questions shown the same way, so that the level only changes developer details.
14. As a person, I want question text and choices escaped, so that what the agent wrote cannot break the page.
15. As a person, I want a free-text answer collapsed to one line, so that the card line stays one line.

## Implementation Decisions

- Picked interface: option A ("안 안에 넣기"). JSON shape:
  - interface: `{ title, questions?: Q[], options: [{ ...existing, questions?: Q[] }] }`
  - architecture: `{ title, questions?: Q[], candidates: [{ ...existing, questions?: Q[] }] }`
  - `Q = { text, choices: string[2..4], recommended?: string }`; `recommended` must equal one of `choices`.
- Validation joins the existing problem lists (Korean messages the agent can fix); a malformed question writes no page.
- "Same text twice in one scope": a scope is the common list plus one option's list, because those are answered together.
- The pure in-page function that builds the copied text grows a third argument, the answered questions as `[text, answer]` pairs (empty answer = unanswered). It returns the text, `null` for a short reason (unchanged), or a list of missing question texts. It stays in the `pure` script so tests run it without a browser.
- Copied text order: `안: <id>`, `이유: <reason>`, then common question lines, then the picked option's question lines.
- The `qh view` success message tells the agent to write the `- [x]` lines under `## 판단 필요` unchanged.
- The qh-cycle skill's JSON shape lines (interface and architecture) mention the optional `questions`.

## Testing Decisions

- Seam: the view module through its public `run` (page HTML and problem messages) and the `pure` script run in a VM context — the same seam as the existing view tests. No new seam.
- Test external behavior only: where a question appears in the HTML (top vs. inside the card), recommended mark and "기타" present, escaping, rejected JSON messages, and what the pure function returns for answered / missing / other-option questions.
- Prior art: the existing view tests that extract `<script id="pure">` and run `decision()` in `vm.runInNewContext`.

## Out of Scope

- Multiple-choice and free-text-only question kinds.
- Prefilling earlier answers on the page (no stale answer can be shown).
- A qh check that every page question has a card line.
- Sending answers to the session directly (backlog item 5).

## Further Notes

- Source: plannotator `packages/core/question-block.ts` (backlog item 1).
- The waiver matcher already reads `- [x] <question> ·` as a prefix, so question text containing ` · ` is still fine.
