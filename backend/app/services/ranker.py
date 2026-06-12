from app.models.schemas import TestCase, Commit

_CATEGORY_WEIGHTS = {
    "CM-": 1.0,
    "MP-": 0.9,
    "OR-": 0.85,
    "FIN-": 0.8,
    "INV-": 0.75,
    "AD-": 0.7,
    "CR-": 0.7,
    "TR-": 0.7,
    "SEC-": 0.6,
    "TVMP-": 0.65,
    "TVOR-": 0.6,
    "AS-": 0.55,
    "AA-": 0.55,
    "MDM-": 0.5,
    "BA-": 0.45,
    "DA-": 0.45,
    "REP-": 0.4,
    "BI-": 0.4,
}


def _base_score(sub_component: str) -> float:
    for prefix, weight in _CATEGORY_WEIGHTS.items():
        if sub_component.startswith(prefix):
            return weight
    return 0.3


def _layer_bonus(layer_found: int) -> float:
    return 0.1 if layer_found == 1 else 0.0


def _commit_overlap_bonus(test: TestCase, commits: list[Commit]) -> float:
    all_tickets = " ".join(t for c in commits for t in c.jira_tickets)
    component_hint = test.sub_component.split("-")[0] if "-" in test.sub_component else ""
    if component_hint and component_hint.lower() in all_tickets.lower():
        return 0.1
    return 0.0


def rank_tests(tests: list[TestCase], commits: list[Commit]) -> list[TestCase]:
    for test in tests:
        score = (
            _base_score(test.sub_component)
            + _layer_bonus(test.layer_found)
            + _commit_overlap_bonus(test, commits)
        )
        test.impact_score = round(min(score, 1.0), 3)

    return sorted(tests, key=lambda t: t.impact_score, reverse=True)
