"""Unit conversions and DGU status derivation."""
from __future__ import annotations

from datetime import datetime, timezone


def fahrenheit_to_celsius(f: float) -> float:
    return round((f - 32) * 5 / 9, 1)


def seconds_to_motohours(s: float) -> float:
    return round(s / 3600, 1)


def kpa_to_bar(kpa: float) -> float:
    return round(kpa / 100, 2)


NA_RAW_VALUES = {65535, 32767}


def is_na(raw: int | None, reason: str | None) -> bool:
    if raw is not None and raw in NA_RAW_VALUES:
        return True
    if reason and "NA" in reason.upper():
        return True
    return False


def derive_connection_status(
    last_seen: datetime | None,
    offline_timeout_sec: int,
) -> str:
    """Определяет статус связи по last_seen_at (любые данные).

    ONLINE  — данные свежие (< offline_timeout)
    DELAY   — данные устаревают (< 2 * offline_timeout)
    OFFLINE — данных нет или сильно устарели (> 2 * offline_timeout)
    """
    if last_seen is None:
        return "OFFLINE"

    now = datetime.now(timezone.utc)
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)

    age = (now - last_seen).total_seconds()
    if age <= offline_timeout_sec:
        return "ONLINE"
    if age <= offline_timeout_sec * 2:
        return "DELAY"
    return "OFFLINE"


def derive_engine_state(
    state_text: str | None,
    last_update: datetime | None,
    offline_timeout_sec: int,
) -> str:
    """Определяет состояние двигателя по регистру 46109."""
    if last_update is None:
        return "OFFLINE"

    now = datetime.now(timezone.utc)
    if last_update.tzinfo is None:
        last_update = last_update.replace(tzinfo=timezone.utc)

    age = (now - last_update).total_seconds()
    if age > offline_timeout_sec:
        return "OFFLINE"

    if state_text is None:
        return "OFFLINE"

    text_lower = state_text.lower()
    if "stopped" in text_lower or "stop" in text_lower:
        return "STOP"
    if "shutdown" in text_lower or "alarm" in text_lower or "fault" in text_lower:
        return "ALARM"

    return "RUN"
