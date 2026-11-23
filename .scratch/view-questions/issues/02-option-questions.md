# 02: Questions inside one option's card

**What to build:** Each interface option may carry its own `questions`. They render inside that option's card, after its description and before the reason box. Copying an option includes the common answers then that option's answers; questions of other options are ignored and never required. The same question text in the common list and one option's list is rejected (they are answered together); the same text in two different options is allowed.

**Blocked by:** 01

**Status:** ready-for-agent

- [x] Option questions render inside their own card only
- [x] Copy requires the common questions and the picked option's questions, and ignores other options' questions
- [x] Answer lines come in order: common, then the picked option's
- [x] A duplicate within one scope is rejected; the same text in two options is accepted
