# 02: PR gate, format check, confirmation numbers and review page use the reader

**What to build:** The four remaining readers of the `## 판단 필요` section call the card module instead of parsing the section themselves: the PR gate's open-question list, the format check's checkbox-less items, the confirmation numbers' approved numbers and open-question filter, and the review page's "what is left" list. Their own parsing for this section is deleted. From this ticket on an indented, `*` or `+` open question blocks the PR, and the review page lists exactly what the PR gate blocks on.

**Blocked by:** 01

**Status:** ready-for-agent

- [x] The PR gate's open questions come from the reader (an indented open question blocks)
- [x] The format check's items come from the reader, same message
- [x] Approved confirmation numbers and the open-question filter come from the reader
- [x] The review page's open questions come from the reader
- [x] No other code parses the `판단 필요` section; all existing tests pass
