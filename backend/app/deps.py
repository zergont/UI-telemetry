from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import Request

if TYPE_CHECKING:
    import asyncpg

    from app.mqtt.hub import TelemetryHub


def get_pool(request: Request) -> asyncpg.Pool:
    return request.app.state.db_pool


def get_hub(request: Request) -> TelemetryHub:
    return request.app.state.hub
