# 01: Common questions at the top of the interface page

**What to build:** An interface JSON may carry a top-level `questions` list. The page shows each question once above the options: its text, its 2–4 choices as single-choice radios, the recommended choice marked, and a "기타" choice with a free-text box. The pick button copies `안`, `이유`, then one `- [x] <question> · <answer>` line per common question; it refuses and names the unanswered common questions. Malformed questions (no text, line break in text, fewer than 2 or more than 4 choices, recommended not among choices, the same text twice) make `qh view` write no page and say what to fix. The success message tells the agent to write the `- [x]` lines under `## 판단 필요` unchanged. A page without questions looks and copies as today.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] Common questions render above the options, escaped, with the recommended mark and "기타"
- [x] The pure copy function returns pick, reason and answer lines; a free-text answer is collapsed to one line
- [x] The pure copy function reports missing common questions; a short reason still returns null
- [x] Malformed questions are rejected with Korean messages and no page is written
- [x] The success message tells the agent where the answer lines go
- [x] Existing view tests still pass unchanged
