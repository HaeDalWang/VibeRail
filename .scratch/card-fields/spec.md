**Status:** ready-for-agent

# Spec: the card module reads the rest of the task card

## Problem Statement

The task card's `## interface 결정` section (안 with its confirmation number, 이유, 설계안, 명세) and its `## 성공 조건 → 검사` and `## 미확인` sections are read by several places, each splitting the card text itself, and they disagree (code read 2026-11-27):

- The 명세 line: the spec check and the AI review start look for a line starting with `명세:` anywhere in the card; the spec confirmation at loop start looks only inside `## interface 결정` (indentation allowed). A 명세 line written outside that section is found by the spec check but not by the loop-start confirmation, so the person's "돌려" approval of the spec can silently drop (hypothesis; the first test reproduces it).
- The 안 and 이유 lines: the cycle stage and the cycle problems read `이유` leniently (`- 이유:`, `**이유**:`, backticks, a full-width colon), while the confirmation number and the review page read only a line that starts with `안:` / `이유:`. A card with `- 안: B` passes the cycle but the confirmation number check cannot find the pick.
- The same per-section line splitter is copied in the confirm module and the review page.
- The section names `성공 조건 → 검사` and `미확인` are string literals in the review page, outside the card module's section names.
- The spec check cuts the card into sections itself to drop `판단 필요` and `루프` before computing its confirmation number.

The person (architecture check 2026-11-27, candidate 1): "위험이 낮은 변경들이므로".

## Solution

The card module answers three questions, and every place that read these sections asks it instead of cutting the card text: what was picked (안, number, 이유, 설계안, 명세), what list lines a section holds, and what the card looks like without some sections. The 명세 line is read only inside `## interface 결정`, by everyone. Line shapes are read leniently and the same way everywhere.

## User Stories

1. As a person, I want the spec check, the AI review start and the loop-start spec confirmation to agree on which spec the card links, so that my approval of the spec is never silently skipped.
2. As a person, I want a 명세 line written outside `## interface 결정` to be treated as no spec by every place, so that what one check sees the others see too.
3. As a person, I want `- 안: B`, `**안**: B` and `안: B` read the same, so that the list marker or bold an agent happens to use changes nothing.
4. As a person, I want `- 이유: …` to count as my reason in the review page and the confirmation number check just as it does in the cycle stage, so that the review page shows the reason qh accepted.
5. As a person, I want indented lines and a full-width colon (`：`) read like plain ones, so that formatting noise does not hide a field.
6. As a person, I want backticks around a path (`` `x/spec.md` ``) ignored, so that a quoted path and a plain path link the same file.
7. As a person, I want the confirmation number on the 안 line (`· 확인 번호 NNNN`) read the same everywhere, so that a changed option is asked about once and only when it really changed.
8. As a person, I want the review page's "picked option" step to show the same 안 and 이유 the cycle accepted, so that what I see matches what qh enforces.
9. As a person, I want the review page's success conditions and unconfirmed items read from the same sections the card format names, so that renaming a section later cannot leave one place behind.
10. As a person, I want a spec check that already passed on my card to stay passed after this change, so that I am not asked to rerun or re-approve it for nothing.
11. As an agent, I want one call that gives me the picked option's fields, so that I never write another regex over the card.
12. As an agent, I want a missing field returned as null rather than an empty string or a placeholder, so that "not written" is one value everywhere.
13. As an agent, I want a card without `## interface 결정` to give a pick with every field null, so that callers need no special case.
14. As a maintainer, I want these rules in the card module with one test file, so that the next card-format change happens once.

## Implementation Decisions

- Picked interface: option A ("칸별로 묻는 함수 세 개 추가", 확인 번호 0056), reason "읽는 장소가 한곳이므로". It goes in the existing card module; no new file.
- Module interface (added next to the existing section reader, decisions reader and seam reader, which stay as they are):
  - `SECTIONS` gains `success: '성공 조건 → 검사'` and `unsure: '미확인'`.
  - `pick(card) → { text, id, number, reason, design, spec }`
    - Reads only `section(card, SECTIONS.interface)` (exact heading, HTML comments removed).
    - A field line is `<label>:` after stripping, in this order: leading whitespace, blockquote `>` markers, a list marker (`-`, `*`, `+`, or `1.`/`1)`), a checkbox, backticks and `**`; the colon may be `:` or `：`. This is the same normalization the existing reason reader (`declaredReason`) applies; that normalization moves into the card module and the reason reader uses it (no duplicate).
    - `text`: the whole value of the `안` line, trimmed (for display). `id`: its first token (up to whitespace or `(`). `number`: the four digits after `확인 번호`, or null.
    - `reason`, `design`, `spec`: the trimmed values of `이유`, `설계안`, `명세`; backticks removed from `design` and `spec`.
    - Any field not written, or written with an empty value, is null. The first matching line wins.
  - `items(card, name) → string[]`: the lines of `section(card, name)` that are list items (`-`, `*`, `+`, any indentation), with the marker removed and trimmed. Non-list lines are dropped.
  - `without(card, names) → string`: the card text with the `## <name>` sections listed in `names` removed (heading through the line before the next `## `), everything else byte-for-byte unchanged. Must give exactly what the spec check's current section cutter gives for the same names, so existing spec check confirmation numbers stay valid.
- Callers:
  - Spec check: the spec path comes from `pick(card).spec`; the card part of its confirmation number comes from `without(card, [decisions, loop])`; the task text says 없음 when `spec` is null.
  - AI review start: the spec placeholder comes from `pick(card).spec`, 없음 when null.
  - Confirmation numbers: the picked option comes from `pick(card)` (`id`, `number`, `design`); the spec confirmation reads `pick(card).spec`. The loop-has-tickets test keeps reading the 루프 section.
  - Review page: the picked option step shows `안: <text>` and `이유: <reason>` from `pick(card)`; success conditions come from `items(card, SECTIONS.success)`; unconfirmed from `items(card, SECTIONS.unsure)`.
  - Cycle stage and cycle problems: the reason check uses `pick(card).reason` instead of scanning the interface section with the reason reader.
  - The copied per-section line splitters in the confirm module and the review page go away.
- Behaviour that changes on purpose: a 명세 line outside `## interface 결정` is no longer seen by the spec check or the AI review start; the review page and the confirmation number check now read list-marked, bold, indented or full-width-colon field lines.

## Testing Decisions

- A good test feeds a card text to the card module and checks what it returns; it does not look at regexes or helpers.
- Seam: the card module's test file only. First test: a card whose 명세 line sits outside `## interface 결정` gives `spec: null` (the drift reproduced: before, the spec check's reader found it while the confirmation did not). Then: `- 안: B (설명) · 확인 번호 1234` gives id `B`, number `1234`, text the whole value; `**이유**：…` and indented `이유:` are read; backticked `설계안`/`명세` paths lose their backticks; missing section or field gives null; `items` drops non-list lines and markers; `without` removes exactly the named sections and matches the old cutter's output on the repository's real cards (byte equality).
- The callers are covered by their existing tests (spec check, confirm, review page, cycle, PR gate, stop hook, CLI); they must pass unchanged.
- Prior art: the section reader and decisions reader tests in the card module's test file.

## Out of Scope

- Reading ticket file paths (they are still collected from the whole card).
- Architecture check candidates 2–4 (decision log module, check record module, stop-turn decision module).
- Any new format check or message for a 명세 line outside `## interface 결정`.

## Further Notes

- Branch from main: `refactor/card-fields`.
- After the change, run the real-record check: render the review page and the spec check task with the current code on this repository's real cards, and read the output.
