# 02: The confirmation number, the review page and the cycle read the pick from the card module

**What to build:** The confirmation number check, the review page's "picked option" step and the cycle's reason check use the card module's pick, so `- 안: B`, `**이유**: …` and indented field lines mean the same everywhere. The card module also returns a section's list lines without markers (`items`), and the section names `성공 조건 → 검사` and `미확인` join its section names; the review page reads success conditions and unconfirmed items through it. The per-section line splitters copied in the confirm module and the review page are removed. See the spec's module interface (`pick`, `items`, `SECTIONS`).

**Blocked by:** 01

**Status:** ready-for-agent

- [x] `items` returns the list lines of a section with markers removed and drops non-list lines, for `-`, `*`, `+` at any indentation
- [x] The section names include success conditions and unconfirmed
- [x] The confirmation number check, the review page and the cycle's reason check get 안 and 이유 only from the card module; no copied line splitter remains; all existing tests pass
- [x] Visible: the review page for a card written with `- 안:` and `- 이유:` shows that 안 and 이유 in the picked option step
