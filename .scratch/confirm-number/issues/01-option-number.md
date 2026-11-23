# 01: Picked option carries a confirmation number

**What to build:** The design page's copied pick line ends with `· 확인 번호 NNNN` (the picked option's number, whitespace ignored, own fields only). qh compares the card's `안:` line number with the option in the linked design file and, through the blocking question list, asks again when they differ ("고른 <id>안이 고른 뒤 바뀌었습니다(확인 번호 <old> → <new>). 바뀐 내용으로 계속할까요?") or when the line has no number ("고른 <id>안(확인 번호 <new>)을 지금 내용 그대로 계속 쓸까요?"). An answered `- [x]` line with that sentence settles it. In this ticket the changes are always reported as not found (`null`).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The copied pick line carries the option's number
- [ ] Whitespace-only edits to the picked option ask nothing; edits to an unpicked option ask nothing
- [ ] A field edit to the picked option asks the changed sentence; an answered line settles it; a second edit asks again
- [ ] A pick line without a number asks the unbound sentence once
- [ ] No design link, a missing file or a missing id asks nothing
- [ ] The question blocks the Stop hook through the existing question list
