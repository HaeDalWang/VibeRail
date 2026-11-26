# 01: Background from the question page is saved on this computer only

**What to build:** The level card on the question page has a second box, "하는 일·배경 (선택, 이 컴퓨터에만 저장)", prefilled from the per-person file's `## 배경`. The copied block gains `배경: <text>` (whitespace collapsed) only when the box is non-empty. `qh answer` accepts that line, also alone; it writes only the `## 배경` body of the per-person file (creating it with the header and an empty 단어집 table when missing), keeps everything else verbatim, makes no criteria change and no decision-log line, and refuses text over the policy length cap naming the limit. Before writing, it appends the per-person file to `.gitignore` if missing.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] The page shows the box under the level question, prefilled from the file; the copied block has the 배경 line only when the box is non-empty
- [x] A block with only a 배경 line is accepted and writes the file; no config change, no decision-log line
- [x] Saving a new background keeps an existing 단어집 table and any other text verbatim
- [x] Text over the length cap is refused with the limit named, nothing written
- [x] An old install whose .gitignore lacks the file gets the ignore line before the write
