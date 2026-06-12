# Objective #1 — Stakeholder Feedback & Direction Alignment

> Captures the feedback received from Shailesh Gandhi (manager) on the POC plan, what it confirmed, what it corrected, and what new directions it opened.

---

## 2026-06-12 — Ranking approach and new signal paths

### Context

After Parts 1 & 2 were built, the POC plan was shared with Shailesh Gandhi, Ashutosh Sarda, and Aparna Khare. Shailesh replied with specific feedback that confirmed some decisions, overruled others, and introduced new directions not in the original plan. This session was about reading that feedback, reconciling it against what's built, and understanding what the next step actually is.

The broader internship objective (#1) is: intelligently select and prioritize regression tests based on code change impact — reducing suite size, improving feedback time, maximizing defect detection efficiency.

### Decisions Made

- **Keep individual Jira test cases as the unit (not TestScriptID → .java mapping)** — Why: Shailesh confirmed this explicitly. `.java` files often combine multiple workflows, making them an unreliable unit. Individual test cases are more precise.

- **Component + sub-component is the right linking dimension** — Why: Shailesh approved this as meaningful. Label and Team were explicitly rejected — they create confusion and are too coarse/misaligned with how tests are actually organized.

- **Ranking must be about change-relevance, not historical performance** — Why: Shailesh called out that historical failure probability, execution time, and defect detection efficiency are *irrelevant to this problem*. The ranking question is: *how likely is this test related to what just changed?* — not *how often has this test failed before?*. This overrules the original Part 3 design.

- **Weekly rolling window is acceptable for POC** — Why: Ideally detection happens at commit time, but for POC purposes a rolling window avoids the complexity of real-time webhook infrastructure.

### Logic & Approach

The core insight from Shailesh's feedback is that Parts 1 & 2 solve the right problem with the right structure — the gap is in *what signals drive relevance ranking*. We were building toward a performance-based ranker (failure rates, execution time). That's a separate optimization problem. The actual ask is a *proximity* ranker: how structurally close is a test to the code that changed?

This reframes Part 3 entirely. Instead of "run the tests most likely to fail historically," the goal is "run the tests most likely to be *affected* by this specific change." Those are different questions with different inputs.

Two new signal paths Shailesh suggested that we haven't explored yet:
1. **Bug history path**: look at historical bugs → their fix commits → which `.java` files were changed → use that to infer which repos map to which tests. This is a data-driven way to build or validate the component mapping rather than relying purely on manual curation.
2. **k8 micro-service linking**: instead of only linking at the Jira component level, explore linking commits to individual Kubernetes microservices. This could provide finer-grained routing than component-level mapping.

### What Was Done

- Reviewed the internship objective emails and Shailesh's reply
- Confirmed that Parts 1 & 2 are structurally sound
- Identified that the ranker (Part 3) needs a different design — change-proximity, not historical performance
- Migrated the old `docs/project.md` file into `documentation/sessions/` in proper docwork format
- Confirmed project overview is correctly captured in CLAUDE.md

### Tradeoffs

| Current approach | Shailesh's direction |
|-----------------|---------------------|
| Rank by historical failure rate + execution time | Rank by relevance to the specific change |
| Static component mapping (manually curated) | Augment/derive from bug history commits |
| Component-level granularity only | Also explore k8 micro-service granularity |

The historical-signals approach isn't wrong in isolation — it's a valid optimization lens. But it's a *different problem* from what's being asked here. Mixing the two would dilute both.

### Relationships

- The corrected ranking direction directly impacts `ranker.py` — the current additive scoring model needs to be revisited.
- The bug history path is a new data source that could strengthen or replace the manually curated `repo_component_mapping.json`.
- The k8 micro-service idea is additive — it adds a new dimension alongside components, not a replacement.
- See [[parts-1-and-2-build]] for what the current selector and ranker actually do.

### Open Questions

- **How do we define "change-proximity" concretely?** Component overlap is one proxy. What else? File path similarity? Ticket hierarchy depth? Commit message semantic similarity?
- **Bug history path**: where does Mediaocean track bug fix commits? Are they in Stash commit messages (Jira link) or somewhere else? Need to validate data availability before designing this.
- **k8 micro-service mapping**: how are k8 services named and where is the service-to-repo mapping? Is there a service registry or does it need to be manually mapped like components?
- **Real-time vs polling**: Shailesh wants detection at commit time eventually. When does this move from polling to webhook? Probably post-POC, but worth noting as the productionization path.
