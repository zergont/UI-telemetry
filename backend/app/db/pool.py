from __future__ import annotations

import asyncpg

from app.config import DatabaseConfig


async def create_pool(cfg: DatabaseConfig) -> asyncpg.Pool:
    return await asyncpg.create_pool(
        host=cfg.host,
        port=cfg.port,
        database=cfg.name,
        user=cfg.ui_user,
        password=cfg.ui_password,
        min_size=cfg.pool_min,
        max_size=cfg.pool_max,
    )


async def close_pool(pool: asyncpg.Pool) -> None:
    await pool.close()
