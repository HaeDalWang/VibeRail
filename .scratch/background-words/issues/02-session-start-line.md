# 02: Session start tells the agent about the word list

**What to build:** The session-start hook adds one agent-facing line (English, like the other session-start lines) from the per-person file, in every project, not only qh-cycle ones: no file, or empty 배경 and no table rows → no line; 배경 and no rows → draft about ten rows of the development words this cycle uses most in the person's field into the 단어집 table, show them once, then use them; rows present → speak to the person with the word list, keep a development word with no match plus a short gloss in brackets, add a row when the person says a word was unclear, never replace GLOSSARY.md terms.

**Blocked by:** 01

**Status:** ready-for-agent

- [x] No file, or an empty file, prints no word-list line
- [x] Background with no rows prints the draft line
- [x] Rows present prints the use line
- [x] The line appears in a project without the qh-cycle skill too
