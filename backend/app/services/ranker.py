from app.models.schemas import TestCase

# This Jira instance's priority scheme is custom, not the generic Jira default
# (Highest/High/Medium/Low/Lowest) — confirmed via GET /rest/api/3/priority:
# 1=Critical, 2=High, 3=Medium, 4=Low, 10000=TBD.
_PRIORITY_ORDER = {"1": 0, "2": 1, "3": 2, "4": 3, "10000": 4}


def rank_tests(tests: list[TestCase]) -> list[TestCase]:
    # Most-triggered first, then highest priority as a tiebreak.
    return sorted(
        tests,
        key=lambda t: (-t.frequency, _PRIORITY_ORDER.get(t.priority_id, 99)),
    )
