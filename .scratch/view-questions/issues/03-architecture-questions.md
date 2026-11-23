# 03: The same questions on the architecture-check page

**What to build:** The architecture JSON accepts top-level `questions` and per-candidate `questions` with the same rules, rendering and copy behaviour as the interface page. The JSON shape lines the agent reads in the qh-cycle skill mention the optional `questions` for both pages.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Architecture page renders common and per-candidate questions like the interface page
- [ ] Copy and rejection rules match the interface page
- [ ] The qh-cycle skill's JSON shape lines include the optional questions
