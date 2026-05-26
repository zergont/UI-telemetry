from __future__ import annotations

import asyncio
import json

import asyncpg

from app.config import DatabaseConfig


async def _init_conn(conn: asyncpg.Connection) -> None:
    """Register JSON/JSONB codecs so asyncpg returns Python dicts, not strings."""
    await conn.set_type_codec(
        "jsonb",
        encoder=json.dumps,
        decoder=json.loads,
        schema="pg_catalog",
    )
    await conn.set_type_codec(
        "json",
        encoder=json.dumps,
        decoder=json.loads,
        schema="pg_catalog",
    )


async def create_pool(cfg: DatabaseConfig) -> asyncpg.Pool:
    return await asyncio.wait_for(
        asyncpg.create_pool(
            host=cfg.host,
            port=cfg.port,
            database=cfg.name,
            user=cfg.ui_user,
            password=cfg.ui_password,
            min_size=0,
            max_size=cfg.pool_max,
            init=_init_conn,
        ),
        timeout=5,
    )


async def close_pool(pool: asyncpg.Pool) -> None:
    await pool.close()
