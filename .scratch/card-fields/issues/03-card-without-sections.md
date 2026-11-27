# 03: The card module gives the card without some sections, for the spec check number

**What to build:** The card module returns the card text with named sections removed (`without`), byte-for-byte the same as the spec check's current section cutter for the same names. The spec check computes its confirmation number from it, so a spec check that already passed stays passed. See the spec's module interface (`without`).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `without` removes exactly the named sections (heading up to the next `## `) and leaves the rest unchanged
- [ ] On every real task card in this repository, `without(card, [판단 필요, 루프])` equals the old cutter's output
- [ ] The spec check no longer cuts the card itself; all existing tests pass
- [ ] Visible: the spec check confirmation number of this repository's last passed card is the same before and after
