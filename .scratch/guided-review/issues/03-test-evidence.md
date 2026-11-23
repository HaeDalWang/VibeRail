# 03: Test evidence per success condition

**What to build:** Step 3 lists each `## 성공 조건 → 검사` line. For lines of the form `- <desc> → <file> "<test name>"`, the quoted name (the part before "…" if cut) is looked up in the last test log: a ✔ line gives 통과, a ✖ line 실패, neither 찾지 못함. Lines without a quoted name show as written with 찾지 못함. When the test evidence's tree hash differs from the current tree, a stale warning shows; when there is no test evidence, a no-record warning shows.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 통과, 실패 and 찾지 못함 each shown for a matching condition line
- [ ] A name cut with "…" matches on its prefix
- [ ] Stale warning when the test record's tree differs from the current tree
- [ ] No-record warning when there is no test evidence
