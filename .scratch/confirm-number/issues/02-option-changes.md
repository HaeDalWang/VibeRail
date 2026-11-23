# 02: Show which fields of the picked option changed

**What to build:** When the picked option changed, qh walks the design file's git history back from HEAD to the version whose option gives the old number, and lists the changed fields old → now (whitespace-collapsed) in the agent text. When no committed version matches (changed before a commit), the changes are `null` and the sentence says to read the current content in full.

**Blocked by:** 01

**Status:** ready-for-agent

- [x] A committed old version gives the changed fields, old → now, and only those
- [x] An uncommitted old version gives no field list and the plain "read it again" note
- [x] The agent text shows the changes so the agent can pass them on
