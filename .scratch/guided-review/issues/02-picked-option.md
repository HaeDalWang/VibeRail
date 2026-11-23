# 02: Picked option step with its picture

**What to build:** Step 2 shows the card's `## interface 결정` 안 and 이유. When a `설계안: <path>` line points to a design JSON holding an option whose id matches the 안 line's id, the step also shows that option's picture, gain and cost (signature and seam on level B), drawn the same way as the design pages. When the file or option is missing, only the card text shows, with a note saying why.

**Blocked by:** 01

**Status:** ready-for-agent

- [x] 안 and 이유 shown from the card with their source
- [x] Picture, gain and cost shown when the design file has the option
- [x] Missing file or missing option falls back to card text with a note
- [x] Signature and seam shown only on level B
