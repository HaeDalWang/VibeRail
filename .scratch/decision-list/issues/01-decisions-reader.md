# 01: The card module reads the 판단 필요 section

**What to build:** The card module reads the task card's `## 판단 필요` section with one lenient rule and returns its open questions, answered lines and checkbox-less top-level items; it also answers "did the person answer this question" (`answerState`, moved here from the waivers module with the same meaning). The waivers module and the criteria/answer-change checks use the moved `answerState`, so from this ticket on an upper-case `[X]` answer, an indented line and a `*`/`+` line settle a waiver or a confirmation. See the spec's module interface.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Indented checkbox lines are read (open and answered)
- [ ] Upper-case `X` counts as answered
- [ ] `*` and `+` markers are read like `-`
- [ ] Only the section headed exactly `판단 필요` is read, HTML comments dropped
- [ ] Plain items are top-level list lines without a checkbox; indented notes and "없음"-style lines are not plain
- [ ] `answerState` is 'yes' only with a non-empty answer after ` · `, 'open' for an exact open line, else 'none'
- [ ] The waivers module no longer has its own section parsing; all existing tests pass
