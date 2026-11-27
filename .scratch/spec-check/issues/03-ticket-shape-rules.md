# 03: Ticket shape problems show in the normal check

**What to build:** For a card that links ticket files, `qh check` (and Stop) lists a policy problem, with what to fix, when a linked ticket file does not exist, has no acceptance box, or names a blocker number that is not one of the card's tickets. No config change.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] A ticket with no acceptance box shows a policy problem naming the ticket (visible: `qh check` output)
- [x] A blocker that names no existing ticket shows a policy problem
- [x] A missing linked ticket file shows a policy problem
- [x] Well-formed tickets and cards without tickets show none
