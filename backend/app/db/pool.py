from __future__ import annotations

import asyncio

import asyncpg

from app.config import DatabaseConfig


async def create_pool(cfg: DatabaseConfig) -> asyncpg.Pool:
    return await asyncio.wait_for(
        asyncpg.create_pool(
            host=cfg.host,
            port=cfg.port,
            database=cfg.name,
            user=cfg.admin_user,
            password=cfg.admin_password,
            min_size=0,
            max_size=cfg.pool_max,
        ),
        timeout=5,
    )


async def close_pool(pool: asyncpg.Pool) -> None:
    await pool.close()
