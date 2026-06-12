# Session 01 — Orientation and Planning

> The first working session after Parts 1 & 2 were built: synthesizing project state, stakeholder feedback, and real system data into a coherent documented plan before writing any more code.

---

## 2026-06-12 — First session post-build: plan established

### Context
Parts 1 & 2 existed as working code but with no clear direction for Part 3 and no documented rationale for any of the decisions made. Simultaneously, stakeholder feedback had arrived (Shailesh Gandhi's email), real system data was available (Jira dashboard, Bitbucket repos), and the existing docs were scattered. The goal of this session was to synthesize all of that into a grounded plan before touching any more code.

### Decisions Made

- **Documentation-first workflow** — every decision gets captured in `documentation/` as it happens, not retrospectively. Why: without this, the reasoning behind decisions evaporates and future sessions start from scratch.

- **Verify-before-proceed as a working principle** — each roadmap step gets tested on real data before the next step starts. Why: the entire plan hinges on one question (do we have per-commit file paths?), and if we assume the answer without checking, everything downstream is built on sand.

- **Roadmap as a single living source of truth** — one file tracks all steps, open questions, and dated audit findings rather than separate planning docs. Why: easier to update, harder to lose, and a new team member (or future session) can get oriented from one place.

- **Change-proximity ranking, not historical signals** — confirmed from Shailesh's feedback. Ranking by historical failure rates / execution time was the original Part 3 plan; it was explicitly rejected. The correct question is: how structurally close is this test to what just changed?

- **File-level data is essential, not optional** — this was the key insight upgrade during this session (see below).

### Key Insight

Going into this session, the plan framed file-level data as "a nice unlock for the ranker." By the end, it was clear it's *essential for selection itself* — because Campaign alone has 552 automated tests. Routing a commit to a component and returning all tests in that component is nearly the same as running the full suite for that area. The upgrade came not from theory but from looking at the actual Jira dashboard numbers. Without file data to narrow inside the component, the tool can't claim to be "smart."

### What Was Done

- Migrated `docs/project.md` → `documentation/sessions/parts-1-and-2-build.md` in proper docwork format; deleted old `docs/` folder
- Created `documentation/decisions/objective-1-stakeholder-alignment.md` — Shailesh's feedback, what it confirmed, what it overruled, new directions opened
- Created `documentation/roadmap/project-roadmap.md` — the 6-step plan, working principles, parked items, open questions
- Appended two dated audit sections to the roadmap: code-vs-roadmap alignment and ground-truth Jira/Bitbucket findings

### Relationships

- [[parts-1-and-2-build]] — what existed before this session; this session builds the plan on top of it
- [[objective-1-stakeholder-alignment]] — the stakeholder feedback that shaped the plan's direction
- [[project-roadmap]] — the living plan that will be updated as each step is verified

### Open Questions

None new — all open questions are captured in the roadmap's Open Questions section. The immediate next action is Step 1: check whether the Stash API exposes per-commit changed file paths.
