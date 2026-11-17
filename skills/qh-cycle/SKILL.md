---
name: qh-cycle
description: Run one task card through the qh cycle — intent, grilling, glossary, interface choice, spec and tickets, TDD at agreed seams, qh review, retro — and the periodic architecture check. Use when starting new work in a qh project, when the user states a new feature or a vague goal, when SessionStart shows a qh-cycle stage, or when the user types /qh-cycle.
---

# qh-cycle

The person picks and gives reasons. You ask, draw, build and review. The vendored skills next to this one are upstream text you must not edit; this file only says when each runs and how it connects to the qh task card.

## Precedence

The Pocock and Karpathy principles in the vendored skills win over any qh rule (docs/adr/0001). If a qh message tells you to do something those skills forbid (for example, refactor inside the red→green loop), follow the skill and tell the user which qh rule conflicted.

## The card

State lives in the branch's task card `.quality/tasks/<branch>.md`. These sections drive the cycle:

- `## 의도` — the person's goal in their words, then the scope agreed at the end of grilling.
- `## 용어` — glossary terms this card introduced or changed (links into `GLOSSARY.md`).
- `## interface 결정` — the option picked, and a line `이유: <the person's reason>`.
- `## 테스트 위치(seam)` — the agreed seams, one path per line. TDD is judged at these paths.

Small fixes (a reproducible bug, a typo, a config value) skip the cycle: write `grilling 불필요: <reason, 5+ chars>` in the card and go straight to `tdd`.

## The loop

| Step | Who starts it | What happens | Card |
|---|---|---|---|
| 1. Grill | you: Skill `grilling`, then `domain-modeling` | Interview until the plan has no silent assumptions. Update `GLOSSARY.md` and ADRs inline as terms and decisions settle. | `## 의도`, `## 용어` |
| ◆① Scope | person | Show the scope in plain Korean, ask them to confirm. | scope appended to `## 의도` |
| 2. Interface | you: Skill `codebase-design` | Design at least two interfaces (DESIGN-IT-TWICE). Write them to a JSON file and run `qh view interface <file>` to make the local HTML. Give the person the path. | |
| ◆② Pick | person | They pick one and must give a reason. No reason, no next step. | `## interface 결정` with `이유:`; the seams go to `## 테스트 위치(seam)` |
| 3. Spec, tickets | person types `/to-spec`, then `/to-tickets` | Upstream writes `.scratch/<feature>/spec.md` and `issues/NN-*.md`. Link them in the card. | link |
| 4. Build | you: Skill `tdd` | One ticket at a time, tests only at the card's seams. Do not call `implement`; it is not installed. | |
| ◆③ Review | you run `qh review`; person reads | Show the person the interface and the tests, not the whole diff. | |
| 5. Retro | person types `/retro` | Turn repeatable mistakes into lint, hooks or tests. | |

Never pass a ◆ step on the person's behalf. When a step needs a slash command, end your turn with one line: the command to type, and why now.

### Skills you cannot call

`to-spec`, `to-tickets`, `retro`, `improve-codebase-architecture` and `grill-with-docs` are user-invoked only. Do not read their files and follow them yourself; tell the person which command to type.

### Review

Where any vendored skill says to call `code-review`, run `qh review` instead. qh review checks against the project standards and the card's success conditions (the spec).

## Architecture check

`qh cycle` says when it is due (three cards finished or seven days since the last check). Then tell the person to type `/improve-codebase-architecture`. They pick one candidate and give a reason (◆④). Record it in `docs/decisions.md` as `아키텍처 점검: <date> · <candidate> · <reason>`. Only the picked candidate is refactored, as its own card. Existing duplicates qh reported as warnings are good input for this step.

## Talking to the person

Read the person's level from `.quality/config.json` `answers.level`:

- **A** (not a developer): Korean, one idea per sentence, only glossary words, short. Draw instead of explaining. Say what changes if they pick each option.
- **B** (developer): the A text, plus interface signatures, seam locations, test names and the dependency category.

This applies only to what the person reads. Files you or other agents read (skills, specs, tickets, ADRs) stay in the language they were written in. Never translate the vendored skills.

Pictures are local HTML only, made by `qh view`. Never publish code or designs to an external service.

The person's instructions to you (an intent) should use glossary terms, identifiers and agreed seams. If they are vague, grill before building.
