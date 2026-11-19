---
name: qh-cycle
description: Run one task card through the qh cycle — intent, grilling, glossary, interface choice, spec and tickets, TDD at agreed seams, qh review, retro — and the periodic architecture check. Use when starting new work in a qh project, when the user states a new feature or a vague goal, when SessionStart shows a qh-cycle stage, or when the user types /qh-cycle.
---

# qh-cycle

The person picks and gives reasons. You ask, draw, build and review. The vendored skills next to this one are upstream text you must not edit; this file only says when each runs and how it connects to the qh task card.

## Precedence

The Pocock principles in the vendored skills and the Karpathy lines listed in docs/adr/0001 (its 출처 part) win over any qh rule. If a qh message tells you to do something those skills forbid (for example, refactor inside the red→green loop), follow the skill and tell the user which qh rule conflicted.

## The card

State lives in the branch's task card `.quality/tasks/<branch>.md`. These sections drive the cycle:

- `## 의도` — the person's goal in their words, then the scope agreed at the end of grilling.
- `## 용어` — glossary terms this card introduced or changed (links into `GLOSSARY.md`).
- `## interface 결정` — the option picked, and a line `이유: <the person's reason>`.
- `## 테스트 위치(seam)` — the agreed seams, one path per line. TDD is judged at these paths.
- `## 루프` — the ticket files of the current round, one path per line (`.scratch/<feature>/issues/NN-*.md`), at most 3.

Small fixes (a reproducible bug, a typo, a config value) skip the cycle: write `grilling 불필요: <reason, 5+ chars>` in the card and go straight to `tdd`. The waiver counts only when the card's `## 판단 필요` holds `- [x] <the question qh hands you, verbatim> · <the person's answer>`: ask it in those words, wait for the answer, then write that line.

## The loop

| Step | Who starts it | What happens | Card |
|---|---|---|---|
| 1. Grill | you: Skill `grilling`, then `domain-modeling` | Interview until the plan has no silent assumptions. Update `GLOSSARY.md` and ADRs inline as terms and decisions settle. | `## 의도`, `## 용어` |
| ◆① Scope | person | Show the scope in plain Korean, ask them to confirm. If they already said yes to this exact scope during grilling, record that answer; do not ask again. | scope appended to `## 의도` |
| 2. Interface | you: Skill `codebase-design` | Design at least two interfaces (DESIGN-IT-TWICE). Write them to a JSON file `{ "title", "options": [{ "id", "name", "summary", "mermaid", "gain", "cost", "signature"?, "seam"? }] }` (all strings, 2+ options) and run `qh view interface <file>` to make the local HTML. Then open it for the person (macOS `open`, Linux `xdg-open`). | |
| ◆② Pick | person | They pick one and must give a reason. No reason, no next step. | `## interface 결정` with `이유:`; the seams go to `## 테스트 위치(seam)` |
| 3. Spec, tickets | person says so in words ("명세 만들어 줘", then "작업 나눠 줘"); you open `.claude/skills/to-spec/SKILL.md`, then `.claude/skills/to-tickets/SKILL.md` | Upstream writes `.scratch/<feature>/spec.md` and `issues/NN-*.md`. Link them in the card. | link |
| ◆ Loop start | person | No reason line. Classify each ticket AFK or HITL: HITL if it needs UI/UX judgment, touches money, security or a data-loss path, or cannot be decided by the agreed seam tests. Set `**Status:** ready-for-human` on HITL tickets (ticket files are project data, not vendored files). Pick up to 3 `ready-for-agent` tickets on the frontier (blockers done). Show in plain Korean what will run, what is theirs, and the stop conditions; wait for "돌려". | paths under `## 루프` |
| 4. Build (loop) | you: Skill `tdd` | In this session, one ticket at a time, tests only at the card's seams. Tick the ticket's acceptance boxes when its seam tests pass. After each ticket tell the person one plain line ("루프 2/3: …"). Stop on any of: all done; the same ticket fails 3 times; a new 판단 필요 appears; the next ticket is the person's; a ratchet block. Say which. Do not call `implement`; it is not installed. | boxes ticked |
| ◆③ Review | you run `qh review`; person reads | Show the person the interface and the tests, not the whole diff. Then re-decide the tickets still open: a new `## 루프` round (back to ◆ Loop start) or end. | |
| 5. Retro | person says so in words ("회고하자"); you open `.claude/skills/retro/SKILL.md` | Turn repeatable mistakes into lint, hooks or tests. | |

Never pass a ◆ step (loop start included) on the person's behalf. When a step is the person's to start, end your turn with one line in plain Korean: what to say to you (for example "명세 만들어 줘"), and why now. Never ask them to type a command.

### Skills you cannot call

`to-spec`, `to-tickets`, `retro`, `improve-codebase-architecture` and `grill-with-docs` are user-invoked only (`disable-model-invocation`), so the Skill tool cannot start them. The person starts them by saying so in words; then you Read the installed file `.claude/skills/<name>/SKILL.md` (qh init copies it there unedited) and follow it as written. Do not start one before the person asks for it, and do not edit it.

### Review

Where any vendored skill says to call `code-review`, run `qh review` instead. qh review checks against the project standards and the card's success conditions (the spec).

## Architecture check

`qh cycle` says when it is due (three cards finished or seven days since the last check). Then tell the person in one plain line that an architecture check is due and what to say ("구조 점검하자"). When they say it, Read `.claude/skills/improve-codebase-architecture/SKILL.md` and follow it, except its HTML report step (the HTML-REPORT file loads CDN scripts and is English): instead write the candidates to a JSON file `{ "title", "candidates": [{ "id", "name", "problem", "solution", "gain", "cost", "strength", "mermaidBefore"?, "mermaidAfter"?, "detail"? }] }` (plain Korean; `detail` holds files and function names for level B) and run `qh view architecture <json>`; then open it for the person (macOS `open`, Linux `xdg-open`) with the page it prints. They pick one candidate and give a reason (◆④). Record it in `docs/decisions.md` as `아키텍처 점검: <date> · <candidate> · <reason>`. Only the picked candidate is refactored, as its own card. Existing duplicates qh reported as warnings are good input for this step.

## Talking to the person

Read the person's level from `.quality/config.json` `answers.level`:

- **A** (not a developer): Korean, one idea per sentence, only glossary words, short. Draw instead of explaining. Say what changes if they pick each option.
- **B** (developer): the A text, plus interface signatures, seam locations, test names and the dependency category.

This applies only to what the person reads. Files you or other agents read (skills, specs, tickets, ADRs) stay in the language they were written in. Never translate the vendored skills.

Pictures are local HTML only, made by `qh view`. Never publish code or designs to an external service.

The person's instructions to you (an intent) should use glossary terms, identifiers and agreed seams. If they are vague, grill before building.
