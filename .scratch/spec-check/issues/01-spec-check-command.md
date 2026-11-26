# 01: The spec check command writes the sub-agent task and records its result

**What to build:** `qh spec-check --task` writes a task file for a fresh sub-agent: it names the task card, the spec and every ticket file the card links (relative paths), the result path, the result shape, and how to start a fresh sub-agent on Claude Code (Agent tool) and Kiro, passing only the task. It prints where the task is and what to do next. `qh spec-check --result [file]` (default: the result path) validates the JSON shape `{ missing, extra, noVisible }` (all three arrays of `{ from|where|ticket, text }`), and records it as evidence with the content number of the card, spec and tickets, the round count for this card and `checker: agent-declared`. A malformed file is refused with the reason and nothing is recorded.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `--task` writes a task naming the card, spec, ticket files and result path, and prints what to do next (visible: the command output and the task file)
- [ ] `--result` with a well-formed file records it with the content number and `checker: agent-declared`
- [ ] `--result` with a malformed file (missing array, wrong item shape, not JSON) is refused with the reason; nothing is recorded
- [ ] A recorded result with missing items or tickets with no visible result counts one round for the card
