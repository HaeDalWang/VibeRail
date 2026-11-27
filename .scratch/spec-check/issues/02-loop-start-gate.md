# 02: "돌려" is asked only after the spec check passes for the current content

**What to build:** In the blocking question list, the spec check comes before the spec confirmation. With linked tickets and no record for the current content: an agent item to run the spec check, and no "명세(확인 번호 …)대로 작업을 시작할까요?". Missing items or tickets with no visible result within 2 rounds: an agent item to fix and rerun. After 2 such rounds: one person question per remaining item ("작업 카드의 'OO'가 명세·작업에 없습니다. 빼고 진행할까요?", "작업 'NN'은 끝나도 확인할 것이 없습니다. 그대로 진행할까요?"). Every unrequested item: "명세에 'OO'가 들어갔습니다. 원하신 건가요?"; a non-yes answer tells the agent to remove it. Answers are `- [x] <question> · <answer>` card lines matched by text and survive reruns. When nothing remains, the spec confirmation is asked. Changed card, spec or ticket content after a pass brings the agent item back.

**Blocked by:** 01

**Status:** ready-for-agent

- [x] Tickets linked, no record → agent item present, spec confirmation absent (visible: `qh check` output)
- [x] Pass for the current content → spec confirmation asked
- [x] Content changed after a pass → agent item again
- [x] Unrequested item → person question; once answered yes it does not return on rerun; a non-yes answer becomes an agent item to remove it
- [x] After 2 failing rounds, remaining missing / no-visible items become person questions
- [x] A card with no linked tickets gets none of these
