# 03: Spec carries a confirmation number from loop start

**What to build:** Once the card's `## 루프` lists a path and `명세:` points at an existing file, qh asks "명세(확인 번호 <new>)대로 작업을 시작할까요?"; the person's "돌려" is written as its answer. When the spec later differs from the latest answered number, qh asks "명세가 확인한 뒤 바뀌었습니다(확인 번호 <old> → <new>). 바뀐 명세대로 계속할까요?" with the `git diff -w` lines against the old committed version (or the plain note when it cannot be found).

**Blocked by:** 02

**Status:** ready-for-agent

- [x] No 루프 paths, no spec link or a missing spec file asks nothing
- [x] With 루프 paths and a spec, the start question is asked once and an answer settles it
- [x] Whitespace-only spec edits ask nothing
- [x] A spec edit after the answer asks again with the changed lines; an uncommitted old version gives the plain note
