**Status:** ready-for-agent

# Spec: confirmation numbers on the picked option and the spec

## Problem Statement

The person picks an interface option on the design page and later approves the spec when they say "돌려". Both are recorded only as card text. If the design file's picked option or the spec is edited afterwards — by the agent, by a later round, by anyone — the old answer still stands and nothing tells the person that what they approved is no longer what will be built. Check evidence is already bound to the code state (tree hash); human decisions are not bound to anything.

## Solution

Each human approval carries a short confirmation number (확인 번호) computed from the approved content, ignoring whitespace. The picked option's number rides in the line the design page copies, so picking asks nothing new. The spec's number is asked once at loop start ("이 명세(확인 번호 …)대로 시작할까요?"), and the person's "돌려" is the answer. When the content later differs from the number, qh blocks at the end of a response and before a PR, shows what changed (old → now, found in git history), and asks again. The finished-work review page shows the same state and changes.

## User Stories

1. As a person picking on the design page, I want the copied line to carry the option's confirmation number, so that my pick is bound to what I saw without an extra question.
2. As a person, I want whitespace, line breaks and indentation differences to count as no change, so that reformatting never asks me again.
3. As a person, I want any other character change in the picked option (name, summary, picture, gain, cost, signature, seam, its questions) to ask me again, so that a changed design is never silently built.
4. As a person, I want edits to options I did not pick to ask nothing, so that I am not asked about things I rejected.
5. As a person, I want the re-ask to show which fields changed, old → now, so that I do not have to hunt for the difference.
6. As a person at loop start, I want qh to ask whether to start from this spec with its confirmation number, so that my "돌려" approves a specific spec version.
7. As a person, I want a spec edited after my "돌려" to ask me again with the changed lines, so that a rewritten spec is not built on my old approval.
8. As a person, I want a plain "it changed, please read the current content again" when the old version cannot be found in git, so that I am still asked even without a diff.
9. As a person with a card picked before this feature (no number), I want one question "keep going with the current content?", so that old cards get bound once with no gap.
10. As a person, I want answering the re-ask to bind the new content, so that I am asked once per change, not on every response.
11. As a person, I want a second change after my re-answer to ask again, so that each version I approve is the one built.
12. As a person reading the review page, I want the picked-option step to say whether the confirmation still matches and, if not, what changed, so that ◆③ shows it too.
13. As a person reading the review page, I want open confirmation questions listed under what is left to decide, so that nothing owed to me is hidden.
14. As an agent, I want the re-ask to come out of the same blocking list as the other questions owed to the person, so that the Stop hook and the PR gate handle it without new wiring.
15. As an agent, I want the question sentence handed to me ready to pass on, and the exact card line that settles it, so that I never invent the wording.
16. As an agent, I want no question when the card has no design-file link, or the file or the picked id is gone, so that cards without a design page are not blocked by something they cannot satisfy.
17. As an agent, I want no spec question before the card's loop section lists tickets, so that writing the spec and the tickets is not interrupted.
18. As an agent, I want no spec question when the card has no spec link or the spec file is missing, so that small cycles are not blocked.
19. As an agent, I want the number to be the same on every machine and in CI for the same content, so that the committed card settles the question everywhere.

## Implementation Decisions

- Picked interface: option A ("확인 번호 전용 모듈 하나"), reason "따로 두는 편이 찾기 쉽다". A new module owns the number, the lookup of old versions and the question text. Callers ask it once each.
- Module interface:
  - `confirmNumber(text) → 'NNNN'`: collapse every whitespace run to one space and trim, sha256, the first 8 hex digits mod 10000, zero-padded to 4 digits (the same shape as the existing secret-waiver number).
  - `optionNumber(option) → 'NNNN'`: the number of the picked option's own fields only — id, name, summary, mermaid, gain, cost, signature, seam, questions — each field whitespace-collapsed, in that fixed order, missing fields as empty.
  - `pendingConfirms(root, { card }) → [{ agent, user, changes }]`: questions still owed. `user` is the sentence the card line must carry; `changes` is `{ kind: 'option' | 'spec', fields | lines | null }` (null = old version not found).
  - `confirmState(root, { card }) → { option, spec }`, each `{ state: 'ok' | 'changed' | 'unbound' | 'none', changes }`, for the review page. (`pendingConfirms` is built on it.)
- Card shapes:
  - Pick: the `안:` line in `## interface 결정` ends with `· 확인 번호 NNNN`. The design page's copy builds it; the agent may add a description between the id and the number, as cards already do.
  - Design file: the `설계안: <path>` line (unchanged). Spec: the `명세: <path>` line (unchanged).
  - Answers live in `## 판단 필요` as `- [x] <user sentence> · <answer>` (existing answer rule). The sentence contains the current number, so a changed content asks again.
- When the option is bound:
  - The `안:` line number equals the current `optionNumber`, or a `- [x]` re-ask line with the current number is answered → ok.
  - The number differs and no answered re-ask → changed: "고른 <id>안이 고른 뒤 바뀌었습니다(확인 번호 <old> → <new>). 바뀐 내용으로 계속할까요?"
  - No number on the `안:` line → unbound: "고른 <id>안(확인 번호 <new>)을 지금 내용 그대로 계속 쓸까요?"
- When the spec is bound: only once `## 루프` lists at least one path and `명세:` points at an existing file.
  - First time: "명세(확인 번호 <new>)대로 작업을 시작할까요?" — the agent asks it at ◆ Loop start and writes the person's "돌려" as the answer.
  - Later, the latest answered spec line's number differs from now → changed: "명세가 확인한 뒤 바뀌었습니다(확인 번호 <old> → <new>). 바뀐 명세대로 계속할까요?"
- Old version lookup (git, no stored copy): walk `git log` of the file from HEAD back; the first commit whose content gives the old number is the old version (option: the same id in that version's JSON). Option changes are listed per field (old → now, whitespace-collapsed). Spec changes are the `git diff -w` hunk lines between that commit and the working file. Not found → `null`.
- Wiring: `qh` gathers `waivers: [...pendingWaivers(...), ...pendingConfirms(...)]`, so Stop and PR blocking, and showing the `user` sentence, follow the existing path. The `agent` text includes the changes so the agent can show them. The CLI file gains one line.
- Design page: each option carries its number; the pure copy function adds `· 확인 번호 NNNN` to the `안:` line.
- Review page: the picked-option step shows the confirmation state and the changes; open confirmation questions appear under 남은 판단.
- qh-cycle ◆② and ◆ Loop start rows mention the number; the reference doc gets one line.

## Testing Decisions

- Seams (agreed on the card): the confirmation module through `pendingConfirms` / `confirmState` in a temp git repo with a card, a design JSON and a spec committed and then edited; the design page's pure copy function; the review page written by `qh review` with a changed design file.
- Test external behaviour: whitespace-only edits ask nothing; a field edit asks with old → now; an edit to an unpicked option asks nothing; an answered re-ask binds; a second edit asks again; a card without number asks once; no 루프 paths → no spec question; spec edited after "돌려" asks with diff lines; uncommitted old version → changes null with the plain sentence; no design link / missing file / missing id → no question; the copy line carries the number.
- Prior art: the waiver tests (answer lines bound to question text), the view tests running the pure copy script, the review-page tests with the installed-repo fixture.

## Out of Scope

- Annotations on the spec or design (backlog 4) and sending page answers to the session (backlog 5).
- Telling a "no" answer apart from a "yes" (the existing answer rule counts any non-empty answer; a "no" means the agent re-picks or rewrites, which changes the content again).
- Numbers for ticket files, the glossary, or ADRs.
- A stored snapshot of approved content.

## Further Notes

- Source idea: plannotator plan diff / stale plan decisions (backlog item 3).
- A 4-digit number lets 1 in 10,000 changes pass unnoticed; same trade-off as the secret-waiver number, which the person reads aloud-ably.
