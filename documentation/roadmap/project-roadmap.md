# Project Roadmap — Smart Regression Optimizer

> The single source of truth for where the project is, where it's going, and what we need to understand at each step. Living document — update as steps complete or understanding changes.

> **⚠ 2026-07-17 note**: The plan below (file-level proximity ranking, Steps 1–6) was the direction as of 2026-06-12 and was never built. What actually shipped (see the 2026-07-17 entry at the bottom) is a different design — Product=Prisma + ticket Tag field → Jira component/sub-component → JQL search, ranked by frequency+priority with no computed score. Read the Steps/design-intuition sections below as historical planning context, not current direction, until this note is resolved.

---

## The One-Line Goal

When code changes land in Bitbucket, select and rank **only the regression tests relevant to that specific change** — instead of running the full suite. Reduce suite size, speed up feedback, keep defect-detection coverage.

(This is internship Objective #1. Objective #2 — failure classification — is deferred.)

---

## The Throughline (read this first)

Everything hinges on **one question: what does a single commit actually give us — the changed file paths, or only the commit message + ticket?**

- If we have **file paths** → we can build a *precise* proximity ranker (we know which module changed).
- If we only have **message + ticket** → we're limited to a *fuzzy* ticket-based ranker and must lean on semantic similarity.

We cannot meaningfully design the ranker until we know this. So Step 1 is the fork in the road.

---

## Where We Already Are (Done)

**As of 2026-07-17**, the shipped pipeline is not the proximity-ranking design this roadmap originally planned toward — see the note at the top of this doc and the 2026-07-17 entry at the bottom for the full pivot story. Current state:

- Scans allowlisted repos in Bitbucket Stash for commits in a time window
- Extracts ADINFRA-*/IAPP-* ticket IDs from commit messages
- Two silent scope checks per ticket: Product field must include "Prisma", ticket must have a non-empty Tag field — everything else is dropped, not flagged as a gap
- Tag field → repo slug → `(component, sub_component)` via `backend/config/tag_component_mapping.json` → JQL search against Jira's `cf[10205]`/`cf[10206]` custom fields (not the system `component` field)
- Ranking is `(-frequency, priority)` only — **no computed `impact_score`, no file-level or proximity signal at all**. The rough component-overlap score mentioned in the line this replaces was removed as redundant (`documentation/decisions/test-case-ranking.md`).
- A working React dashboard (`Dashboard.jsx`) — trace view, ticket drill-down with file/diff viewer, recommended-tests table — plus Docker/single-VM deployment.
- A parallel coverage-based (JaCoCo) TIA trial was designed and partially built as Approach 2, then stripped back out of the tracked backend as of 2026-07-15 (`documentation/decisions/coverage-based-test-impact-analysis.md`) — currently unreachable, not merely low-confidence.

**What's solid:** the plumbing works, and it's shipped/in use as a real Prisma/Tag-based selector — a materially different, simpler design than the proximity model below.
**What's unresolved:** whether to still pursue the file-level proximity design at all, now that a different (Tag/component-based) approach already works. This needs an explicit decision, not silent abandonment.

See [[parts-1-and-2-build]] and [[objective-1-stakeholder-alignment]] for the original build detail (predates the Prisma/Tag pivot).

---

## Working Principle — Verify Each Step Before Moving On

Every step ends with a **checkpoint**: we test it on real data and confirm it's correct before starting the next step. We never build on an unverified step.

This matters most because of the throughline — if Step 1 is wrong (we assume we have file data but don't), everything built on top of it is built on sand. So each step is proven with a real test, not an assumption.

---

## The Steps

### Step 1 — Find out what a commit actually gives us
**Do:** Inspect the Stash API + `stash_service.py` — can we get **changed file paths** per commit, not just the message?
**Need to understand:** Is file-level data available, and in what shape (full paths? filenames only?)?
**Why first:** This decides whether we build a precise or fuzzy ranker. **The fork in the road.**

### Step 2 — Map available data to the signals we want
**Do:** For each ranking signal — file overlap, ticket-hop distance, semantic similarity — check whether the data exists to compute it.
**Need to understand:** Which signals are *real* (we have data) vs *aspirational* (we'd need data we can't get). Only design around signals we can actually feed.

### Step 3 — Understand the "sharpness" of our tickets and components
**Do:** Pull real tickets from Jira — how many test cases does a typical ticket link to? How big are the components?
**Need to understand:** Are tickets sharp pointers (2–3 tests) or diffuse buckets (40 tests)? This tells us how much we can trust the ticket signal, and validates whether the "irrelevant ticket / ticket with many commits" worry is a big problem or a small one in practice.

### Step 4 — Design the proximity scoring model
**Do:** Define how signals combine into one `impact_score` — which signals, what weights, how *agreement* between signals boosts confidence.
**Need to understand:** How to express "this test is close to this change" as a number, and how to handle disagreement (ticket-says-X but files-say-Y → discount the ticket).

### Step 5 — Rebuild the ranker
**Do:** Replace the current history-flavored scoring in `ranker.py` with the Step 4 proximity model.
**Need to understand:** Does the new ranking look right on real commits — do the top tests actually make sense for the change?

### Step 6 — Validate against reality
**Do:** Take recent real changes; check whether our top-ranked tests would have caught what mattered.
**Need to understand:** Does selection save time *without* missing coverage? This is what proves the POC's value.

---

## How the Ranking Will Actually Work (the design intuition)

The key principle: **a Jira ticket is a fuzzy container, not a precise pointer. Trust the commit's actual changed files as ground truth; use the ticket only as corroboration.**

Signals in order of reliability:
1. **Changed files = ground truth** — the diff can't lie the way a ticket can. (Depends on Step 1.)
2. **Ticket, weighted by sharpness** — a ticket linked to 2 tests is trustworthy; one linked to 40 is diffuse and gets down-weighted (its influence is inverse to its breadth).
3. **Agreement between signals = confidence** — if files say "flighting" and the ticket also points to flighting tests, they corroborate → rank high. If they disagree, the ticket is probably noise for this commit → discount it.

This directly handles the hard cases:
- **Irrelevant ticket** → its tests aren't corroborated by the changed files → discounted.
- **Ticket with many commits over time** → we rank **per-commit**, looking only at *this* commit's files, so a long-lived ticket can't flood us.

---

## Parked / Later (don't touch yet)

| Item | Why parked | When |
|------|-----------|------|
| Bug-history path (bugs → fix commits → files) | A data source to explore once we know what file data exists | After Step 2 |
| k8 micro-service linking | Additional granularity layer beyond components | After components are solid |
| ReportPortal | Belongs to Objective #2 (failure classification), not #1 | Objective #2 |
| ~~Frontend dashboard~~ | **Done** — built ahead of the original plan's sequencing, alongside the Prisma/Tag pipeline pivot rather than after a proximity ranker | Shipped 2026-07-13 onward |

---

## Open Questions Still Needing Answers

- **Step 1**: Does Stash expose per-commit changed files via the API we already use?
- **Step 3**: How sharp are real tickets — do we even have a diffuseness problem?
- **Bug-history**: Where does Mediaocean record bug→fix-commit links? In Jira? In commit messages?
- **k8**: Is there a service registry mapping repo → k8 service, or is it manual like components?
- **Productionization**: Shailesh wants commit-time detection eventually. When do we move from polling to webhooks? (Post-POC.)

---

## 2026-06-12 — Code-vs-roadmap alignment audit

### Context
Before starting Step 1, we read the actual current code (`stash_service.py`, `selector.py`, `ranker.py`) to confirm whether the roadmap's assumptions match reality — specifically, whether the two things the plan centers on (file-level data and proximity ranking) already exist in some form.

### What We Found
- **File-level data is genuinely absent.** `stash_service.py` fetches only commit message, author, timestamp, repo, and ticket IDs. It never calls Stash's changed-files/diff endpoint. The throughline question ("do we have file data?") is answered by the code: **no, not today.** Step 1 is real work.
- **The selector is the textbook fuzzy-container approach.** It routes commit → ticket Tag field → repo slug → component → tests. Everything is component-level; there is zero file-level matching. It matches the *problem* we described, not the *fix*.
- **The ranker is not what the original plan implied — and that's good news.** The rejected "historical failure / execution time" model was never actually built. What exists is a *category-importance* model: static weights per sub-component prefix (`CM-`=1.0 … `REP-`=0.4), plus a small layer-link bonus and a commit-overlap bonus.

### Key Insight
The biggest mismatch is subtle: the current ranker scores tests by **how important an area is in general**, not **how related the test is to the specific change**. Those feel similar but are different questions — and Shailesh's correction was precisely about this distinction. So the base-score weights are the part most in need of replacement in Step 5, even though they aren't the "historical signals" we originally flagged.

The two seeds worth keeping: `_layer_bonus` (direct link = closer = crude proximity) and `_commit_overlap_bonus` (weak proximity). Both already gesture at proximity ranking and can fold into the Step 4 model rather than being thrown away.

### Relationships
- Confirms the [[parts-1-and-2-build]] plumbing is solid but validates that Steps 1, 4, and 5 are the real remaining work.
- Reinforces why Step 1 is the unlock: the selector can't sharpen beyond component-level until file data exists to match against.

### Open Questions
- What is the exact Stash API endpoint for per-commit changed files (`/commits/{id}/changes`?), and what shape does it return? (First concrete Step 1 action.)
- Cost concern: fetching changed files is an extra API call *per commit* — does that blow up our request budget across 40–80 repos? May need the same semaphore pattern already used for repos/Jira.

---

## 2026-06-12 — Ground-truth findings from Jira + Bitbucket UI

### Context
Before starting Step 1, we inspected the real systems directly (Jira automation dashboard, the live JQL filter, and the Bitbucket CM repo list) to ground the plan in actual data shapes and volumes rather than assumptions. What we found confirms the diffuseness problem is not hypothetical — it's the central challenge.

### What We Now Know For Certain

**1. Jira test cases are organized by Component, and components are huge.**
The "Prisma Digital Automation Coverage UI" dashboard groups tests by Prisma Component (1P, Adserving, Agency_Admin, Agency_Setup, Campaign… **20 components total**). Hard numbers:
- **Campaign component alone: 552 automated ("Yes") tests** out of 1,263 total issues.
- **~6,952 automated tests** exist across all components (10,029 total issues).
- Tests carry an "Automated" status: Yes / To Be Automated / In Maintenance / Backlog / Blocked / Out of Scope / Selected / In Progress.

Implication: our selector routes commit → component → *all tests in that component*. A single Campaign-area change therefore selects ~552 tests — nearly the full area suite. **Component-level selection alone is far too coarse to count as "smart" regression.**

**2. The canonical Selenium/Automated filter is confirmed correct.**
The authoritative JQL (filter `PTA_Digital_1`):
```
Filter = PTA_Digital_1
and ("Automation Tool (migrated)[Dropdown]" in (Selenium, empty)
     or "Automation Tool[Dropdown]" in (Selenium, empty))
and (labels not in (API, CrossMedia_LTV, CrossMedia_NTV, CrossMedia_Radio,
     LocalTV, NationalTV, Converged, TV_Mediaplan) or labels is empty)
and "Automated[Dropdown]" = Yes
ORDER BY created DESC
```
This matches our `jira_service.SELENIUM_FILTER` conceptually: the named dropdown fields map to our `cf[11133]` / `cf[10158]` (Automation Tool) and `cf[10159]` (Automated = Yes), plus the same label exclusions. **Our filter logic is sound.** But note: **1,000+ test cases pass this filter** — it narrows to "automated & runnable," not "relevant to this change." Relevance is entirely our job.

**3. The repo→component granularity mismatch is the core problem.**
Bitbucket CM repos are **fine-grained**: `campaign-management`, `cm-buy-fee`, `cm-buy-tv`, `cm-buy-sidebar`, `cm-campaign-ui`, `cm-common-forms-lineitem`, `cm-common-forms-move`, etc. Jira components are **coarse**: just "Campaign," "Adserving," etc. So the mapping is **many repos → one component**.
- A dozen `cm-*` repos likely all collapse into "Campaign."
- `campaign-management` is a monolith: **2,317 commits / 36 GB** — mapping it to a single component is nearly meaningless.
- Many repos show `jenkins` as last committer (automated release commits — we already skip `[jenkins-release]` messages, good).

### Key Insight — This Promotes Step 1 from "Unlock" to "Essential"

The logic chain is now concrete:
1. Repo → component is many-to-one and coarse → selects **hundreds** of tests.
2. The only way to sharpen inside those hundreds is to know **which files changed** and match them against **sub-components** (the ranker's `CM-`/`MP-`/`REP-` prefixes are finer-grained than the top-level component).
3. Therefore file-level data is not just for *ranking* — it is what makes the *selection* meaningful in the first place.

The diffuseness concern raised earlier is real and large: at ~552 tests per component, narrowing is the whole game.

### Relationships
- Directly validates Step 3 (ticket/component sharpness) — components are confirmed *very* diffuse; we still need to measure whether individual tickets are sharper.
- Confirms the [[objective-1-stakeholder-alignment]] decision to keep component+sub-component linking (sub-component is the finer grain we'll lean on) and to reject label/team.
- Strengthens the case that the ranker's area-importance weights must become change-proximity weights ([[parts-1-and-2-build]]).

### Open Questions
- Do the Prisma dashboard "Components" (Campaign, Adserving…) exactly equal the Jira `component` field our `layer2_component_search` queries? Need to confirm the names line up with `repo_component_mapping.json`.
- What sub-components exist under "Campaign," and how many tests each? That tells us how much sharpening sub-component matching actually buys us.
- How do we get from a changed file path (e.g. `cm-buy-tv/...BudgetTv.java`) to a sub-component? Is there a naming convention, or does it need its own mapping?

---

## 2026-07-17 — Documentation audit: this roadmap had drifted ~5 weeks behind a real pivot

### Context

A full documentation-vs-code audit (comparing every doc under `documentation/` against actual current source, not against other docs) found this roadmap hadn't been updated since 2026-06-12 despite 20+ commits since. The gap wasn't cosmetic — the shipped pipeline took a different path than the one this roadmap was steering toward.

### What We Found

The roadmap's throughline was: get file-level diff data → build a change-proximity ranker → replace the coarse category-importance scoring in `ranker.py`. None of that happened. Instead, commit `34024f5` ("Scope Approach 1 to Prisma/Global Invoices, fix Jira field-ID bugs, simplify ranking, redesign dashboard", 2026-07-13) took the pipeline in a different direction entirely:

- Selection scope narrowed to Product=Prisma tickets with a non-empty Tag field (`documentation/decisions/prisma-ingestion-scope.md`), not broadened via file-level matching.
- Component resolution now reads the Tag field's repo slug directly against a small curated JSON map (`tag_component_mapping.json`), not a proximity signal derived from diffs (`documentation/decisions/component-resolution-from-tag.md`).
- Ranking was **simplified**, not sharpened — the old 4-factor weighted score (the thing Step 4/5 here were meant to replace with something *better*) was instead stripped down to `(-frequency, priority)` with no computed score at all (`documentation/decisions/test-case-ranking.md`). The diffuseness problem this roadmap worried about (hundreds of tests per component) was addressed by narrowing *scope* (Prisma + Tag required) rather than by *ranking* more precisely within a broad scope.
- A file-level, coverage-based alternative *was* explored — but as a completely separate design (JaCoCo reverse-index lookup, `documentation/decisions/coverage-based-test-impact-analysis.md`), not as an extension of this roadmap's file-overlap ranking idea. That trial was itself built, then stripped back out of the tracked backend on 2026-07-15.

### Key Insight

Nobody made an explicit "abandon the proximity plan" decision that got written down — it's an implicit pivot, visible only by comparing this roadmap against `git log` and the decision docs. That's exactly the kind of drift this audit exists to catch: the roadmap document says one plan is in progress while the shipped code embodies a different, already-completed one.

### What Was Done (this audit)

- Added a warning note near the top of this doc pointing at this entry.
- Rewrote "Where We Already Are" to describe the actual shipped Prisma/Tag/component pipeline instead of the never-built proximity plan.
- Marked "Frontend dashboard" in the Parked/Later table as done.
- Left Steps 1–6 and the "design intuition" sections below **unedited** — kept as the historical record of the original plan, not deleted, since they may still be worth returning to (see Open Questions).

### Open Questions

- Is the file-level proximity ranking idea still worth pursuing given the Prisma/Tag pipeline already works and is in use? If component/sub-component scoping already solves enough of the diffuseness problem in practice, Steps 1–6 below may be moot rather than merely delayed.
- If proximity ranking *is* still wanted, should it now be scoped as a refinement on top of the Prisma/Tag-filtered result set (rank within the already-narrowed scope) rather than the original plan's role of doing the narrowing itself?
- This audit only fixed the roadmap's status framing — it did not re-litigate whether the Prisma/Tag pipeline's simplified ranking is good enough. Worth a deliberate checkpoint (per this doc's own "verify each step" principle) rather than treating the current shipped state as implicitly validated.
