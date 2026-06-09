from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from app.models.stash_models import ActiveReposResponse, DateRange
from app.services.stash_service import get_active_repos
from app.utils.date_utils import format_date, get_date_range

router = APIRouter(prefix="/api/repos", tags=["stash"])


@router.get("/active", response_model=ActiveReposResponse)
async def get_active_repos_endpoint(
    range: Optional[str] = Query(
        None,
        description="Preset: today | last_7d | last_30d | last_90d",
    ),
    from_date: Optional[str] = Query(
        None,
        alias="from",
        description="Start date YYYY-MM-DD (use with 'to')",
    ),
    to_date: Optional[str] = Query(
        None,
        alias="to",
        description="End date YYYY-MM-DD (use with 'from')",
    ),
):
    try:
        from_dt, to_dt = get_date_range(
            range_preset=range,
            from_date=from_date,
            to_date=to_date,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    active_repos, total_scanned = await get_active_repos(from_dt, to_dt)

    return ActiveReposResponse(
        date_range=DateRange(
            from_date=format_date(from_dt),
            to_date=format_date(to_dt),
        ),
        total_repos_scanned=total_scanned,
        active_repos=len(active_repos),
        repos=active_repos,
    )
