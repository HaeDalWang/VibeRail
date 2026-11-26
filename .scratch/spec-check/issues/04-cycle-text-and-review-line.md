# 04: The cycle tells the person and the review page shows the checker limit

**What to build:** The qh-cycle skill (ours, not vendored): step 3 says to announce, when answering the to-tickets breakdown question, that the machine checks after the files are written, and to run the spec check after writing them; ◆ Loop start's summary carries one result line ("명세 대조: 말한 것 N개 모두 들어감, 작업마다 끝나면 볼 것 있음"). The completion review page shows one spec check line with the result and "검사자: 에이전트 신고(기계 확인 아님)". The reference doc lists the command and the gate; one line in the decision log.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] The review page shows the spec check line with the checker limit when a record exists, and nothing when none (visible: the review page)
- [ ] The qh-cycle skill text carries the announcement, the run step and the summary line
- [ ] Reference doc and decision log updated
