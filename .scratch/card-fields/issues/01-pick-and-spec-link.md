# 01: The card module reads the picked option, and every spec reader uses it

**What to build:** The card module answers "what was picked" for a task card: the 안 value, its id and confirmation number, 이유, 설계안 and 명세, read only inside `## interface 결정` with the lenient line shape from the spec (list marker, checkbox, blockquote, bold, backticks, indentation, full-width colon), each missing field null. The spec check, the AI review start and the loop-start spec confirmation all take the spec link from it, so a 명세 line written outside `## interface 결정` is "no spec" for all three. The reason reader's line normalization moves into the card module and the reason reader reuses it. See the spec's module interface (`pick`).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A card whose 명세 line sits outside `## interface 결정` gives a null spec (first test, reproduces the drift)
- [ ] `- 안: B (설명) · 확인 번호 1234` gives id `B`, number `1234`, and the whole value as text
- [ ] `**이유**：…`, an indented `이유:` and a list-marked `- 이유:` are all read as the reason
- [ ] Backticks around the 설계안 and 명세 paths are removed
- [ ] A card without `## interface 결정`, or without a field, gives null for that field
- [ ] The spec check, the AI review start and the spec confirmation take the spec only from the card module; all existing tests pass
- [ ] Visible: the spec check task text built from a card with the 명세 line outside the section says 없음 for the spec
