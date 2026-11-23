# Change review (qh review)

Review one change in this repository with a fixed checklist. A person (possibly a non-developer) reads the result.

## Input
- Working directory: `{{ROOT}}` (current code with the change applied)
- Change under review: `{{DIFF}}` (diff against base `{{BASE}}`, including uncommitted changes)
- What the person agreed to: task card `{{CARD}}` (intent, success conditions, decisions) and spec `{{SPEC}}`, relative to the working directory. Judge the change against these; `없음` means there is none. The author's own explanation is left out on purpose.
- Do not read anything outside the working directory. Do not web-search for this code or company information.

## Scope and limits
- Flag only: lines this change added or modified, and the code right next to them whose behavior the change alters (callers and callees). Do not flag existing problems unrelated to the change.
- Do not use subagents. Do not build, install, or run code. Flag at most 15. Zero may be the right answer.

## Checklist (fixed)
1. Permissions and data isolation 2. Input validation 3. Error handling and data loss 4. External integration (timeout, pagination, response format) 5. UI flow (state refresh, conditional rendering, frontend↔backend path/field mismatch) 6. Fake tests: a test this change added or edited that cannot fail (asserts nothing about the changed behavior, always true, skipped, or mocks away the code under test) 7. Other obvious logic errors

## Procedure
First pass: read the diff and related code and flag. Then reopen the code for each flag and mark it `confirmed/doubtful/rejected`. Drop rejected ones.

## Output (write only to `{{OUT}}`)
- `{{OUT}}/result.json`: an array. Element `{file, line, rank, severity("높음"|"중간"|"낮음"), verdict("confirmed"|"doubtful"), checklist, reason, nextAction}`. file is relative to the working directory; line is the line in the current file. reason and nextAction are one Korean line a non-developer can read. If nothing is flagged, `[]`.

## Forbidden
commit, push, deploy, package install, running code. Do not modify files outside `{{OUT}}`.

## Final response
The result.json path and the flag counts (by verdict), in 3 lines or fewer.
