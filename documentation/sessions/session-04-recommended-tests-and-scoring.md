# Session 04 — Recommended Tests Tab & Scoring Design

> Covers the design and build of the "Recommended Tests" tab, including the scoring formula debate, the frequency + priority ranking signals, and a tag separator bug discovered along the way.

---

## 2026-06-17 — Scoring design, ranked test tab built

### Context

After confirming the diff viewer worked (Session 03), the next milestone was answering the question a QA engineer or manager actually cares about: *"Given this week's code changes, which tests should I run and in what order?"* The existing `/api/tests` endpoint returned 473 test cases in an unsorted flat list with a basic impact score. The goal was to build a ranked, prioritized view that could be demonstrated to a manager.

### Decisions Made

- **Frequency as the primary new ranking signal** — Why: if the same test case is triggered by three independent dev tickets in the same week, it means three separate code changes all touched the same area. That convergence is a strong objective signal that the area is "hot" and the test is high-value. Importantly, frequency requires no extra API calls — it's derivable from data already in hand.

- **Ticket priority (Jira `priority.id`) as the secondary signal** — Why: a test triggered by a High-priority (P2) bug fix should rank above an identical test triggered by a Low-priority (P4) story. The `priority.id` field was already fetchable in the same Jira call as the tag field — just add it to the `?fields=` query. Priority IDs are `1` (Highest) through `5` (Lowest/Trivial).

- **Rejected: ticket type (Bug > Story > Task) as a signal** — Why it was rejected: the user pushed back correctly — a Story with TC1 appearing five times is more important than a Bug that triggers TC1 once. Type is a weaker, less objective signal than frequency. Frequency dominates.

- **Rejected: grouping by dev ticket on the "Recommended Tests" tab** — Why: many test cases appear across multiple tickets (duplicate problem). Grouping by ticket makes the same test appear in multiple places and creates noise. Three alternative layouts were proposed: ranked flat list, impact tiers (Critical/High/Medium/Low), and component summary cards + flat list. The decision was to build the **flat list first** to validate data before committing to a tier grouping — "print first, then add severity grouping."

- **Lazy-load the tests tab** — Why: `/api/tests` is a heavy call — it reruns the full selector + ranker including Jira test case searches. Loading it eagerly on pipeline run would double the wait time. The tab loads only when first clicked.

- **ScorePill tiers mapped to numerical thresholds** — Critical ≥ 1.1, High ≥ 0.8, Medium ≥ 0.5, Low < 0.5. The cap of 1.0 on `impact_score` was removed — frequency and priority bonuses can legitimately push a test above 1.0 (max theoretical: ~1.9 = 1.0 base + 0.3 freq + 0.3 priority + 0.1 layer + 0.1 overlap).

### Logic & Approach

**Scoring formula:**
```
final_score = base_weight(sub_component)     # 0.3–1.0 by component prefix
            + layer_bonus                    # +0.1 if Layer 1 (direct link)
            + overlap_bonus                  # +0.1 if sub_component prefix in ticket IDs
            + frequency_bonus                # +0.1 per additional commit, capped +0.3
            + priority_bonus                 # +0.3/+0.2/+0.1/0 for P1/P2/P3/P4+
```

**Frequency tracking:** The selector already deduplicates test cases globally before returning. Frequency needs to be measured *before* that deduplication — specifically, how many commit-level result sets contain the same test ID. If TC1 appears in commit A's results and commit B's results, frequency = 2 regardless of how many Jira tickets those commits reference. The "best priority" (lowest ID number) across all triggering commits is also tracked and stamped on the test case before the global dedup.

**Priority propagation:** A test case's `ticket_priority_id` is set to the lowest priority ID (= highest severity) seen across all tickets and commits that triggered it. If TC1 is triggered by both a P2 and a P4 ticket, it gets the P2 bonus.

### What Was Done

- `TestCase` schema gained two fields: `frequency` and `ticket_priority_id`
- `get_ticket_details()` now fetches `priority` alongside the tag field (one extra field, same API call)
- `selector.py` tracks `frequency_map` and `best_priority_map` per test ID, stamps both on each test before global dedup
- `ranker.py` gained `_frequency_bonus()` and `_priority_bonus()`, removed the 1.0 score cap
- `fetchTests()` added to frontend API util
- "Recommended Tests" tab added to Dashboard: lazy-loaded, flat ranked table with columns for Jira ID, summary, component, priority badge, frequency, and score tier
- `PriorityBadge` and `ScorePill` components for visual ranking signals

### Bug Fixed Along the Way

**Tag separator was `,` only — but some tickets use `;`**

`ADINFRA-442711` had tag `prisma-locale-bundle:2026.5.8; campaign-management:2026.5.148`. The `extract_repo_slugs_from_tag` function split on comma only, so `campaign-management` was never extracted. The fix was `re.split(r'[,;]', tag_text)` — handle both separators. The frontend TEST SEARCH display was also fixed to show a JQL line for each component, not just `components[0]`.

### Tradeoffs

| Decision | What we gave up / Risk |
|---|---|
| Flat list first, no tier grouping yet | The "Critical/High/Medium/Low" tier view (the originally planned layout) still needs to be built as Phase 2 of this tab |
| Frequency = per-commit, not per-ticket | If one commit has 5 tickets that all trigger TC1, `select_tests_for_commit` deduplicates within the commit so frequency still counts as 1. Frequency only increments when different *commits* trigger the same test. This is the right behavior. |
| Priority from the dev ticket, not the test case | Test cases in IAPP project also have priority fields, but fetching them would require a separate API call per test case (hundreds of calls). Using the dev ticket priority is a one-field addition. |

### Relationships

- Builds on `select_tests_for_commits` and `rank_tests` from [[parts-1-and-2-build]] — extends their scoring logic rather than replacing it
- The frequency signal is only meaningful because the selector deduplicates globally first — if dedup strategy ever changes, frequency logic needs a review
- The 1-component observation (all 473 tests from "mediaplan") flags an unresolved mapping gap: repo slugs from the Tag field (e.g. `campaign-management`) may not match Jira test component names. This was an open question from [[session-02-ui-build-and-jira-field-discovery]] and remains open.

### Open Questions

- **Component name mismatch**: The Recommended Tests tab shows 1 component ("mediaplan") despite the trace showing multiple components. The repo slugs from the Tag field (e.g. `campaign-management`) may not exist as component names in the IAPP Jira test project. How should this mapping be resolved? Options: a curated mapping file, asking the QA team for the correct Jira component names, or querying Jira's component list for the IAPP project.
- **Tier grouping**: The Critical/High/Medium/Low tier grouping view was designed but not yet built. When the user is satisfied with the flat list data, this is the next visual layer to add.
- **Score thresholds may need tuning**: All current tests show "Low" because `sub_component` is empty for most test cases (base score = 0.3). Once the component mismatch is resolved and more test cases are flowing through, the thresholds (≥1.1, ≥0.8, ≥0.5) may need adjusting based on observed score distribution.
