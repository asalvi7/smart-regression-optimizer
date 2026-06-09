from datetime import datetime, timedelta, timezone
from typing import Tuple


def get_date_range(
    range_preset: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
) -> Tuple[datetime, datetime]:
    """
    Returns (from_dt, to_dt) as timezone-aware UTC datetimes.

    range_preset values: today, last_7d, last_30d, last_90d
    Custom range: pass from_date and to_date as "YYYY-MM-DD" strings.
    """
    now = datetime.now(tz=timezone.utc)
    end_of_today = now.replace(hour=23, minute=59, second=59, microsecond=999999)

    if range_preset:
        preset_map = {
            "today": timedelta(days=0),
            "last_7d": timedelta(days=7),
            "last_30d": timedelta(days=30),
            "last_90d": timedelta(days=90),
        }
        if range_preset not in preset_map:
            raise ValueError(
                f"Invalid range preset '{range_preset}'. "
                f"Valid options: {', '.join(preset_map)}"
            )
        delta = preset_map[range_preset]
        from_dt = (now - delta).replace(hour=0, minute=0, second=0, microsecond=0)
        return from_dt, end_of_today

    if from_date and to_date:
        from_dt = datetime.strptime(from_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        to_dt = datetime.strptime(to_date, "%Y-%m-%d").replace(
            hour=23, minute=59, second=59, tzinfo=timezone.utc
        )
        if from_dt > to_dt:
            raise ValueError("'from' date must not be after 'to' date.")
        return from_dt, to_dt

    raise ValueError("Provide either 'range' preset or both 'from' and 'to' dates.")


def to_epoch_ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def format_date(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d")
