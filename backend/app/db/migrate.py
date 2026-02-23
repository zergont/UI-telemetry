"""One-time idempotent migrations run on startup using admin credentials.

Creates the cg_ui database user, grants appropriate permissions,
and adds the equipment.name column for aliases.
"""
from __future__ import annotations

import logging

import asyncpg

from app.config import DatabaseConfig

logger = logging.getLogger(__name__)


async def run_migrations(cfg: DatabaseConfig) -> None:
    conn: asyncpg.Connection = await asyncpg.connect(
        host=cfg.host,
        port=cfg.port,
        database=cfg.name,
        user=cfg.admin_user,
        password=cfg.admin_password,
    )
    try:
        # 1. Create cg_ui role if not exists
        exists = await conn.fetchval(
            "SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1",
            cfg.ui_user,
        )
        if not exists:
            await conn.execute(
                f"CREATE ROLE {cfg.ui_user} WITH LOGIN PASSWORD '{cfg.ui_password}'"
            )
            logger.info("Created database user: %s", cfg.ui_user)
        else:
            logger.info("Database user %s already exists", cfg.ui_user)

        # 2. Grant permissions
        grants = [
            f"GRANT CONNECT ON DATABASE {cfg.name} TO {cfg.ui_user}",
            f"GRANT USAGE ON SCHEMA public TO {cfg.ui_user}",
            f"GRANT SELECT ON ALL TABLES IN SCHEMA public TO {cfg.ui_user}",
            f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO {cfg.ui_user}",
            f"GRANT UPDATE (name, notes) ON objects TO {cfg.ui_user}",
        ]

        # 3. Add equipment.name column if not exists
        col_exists = await conn.fetchval(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'equipment' AND column_name = 'name'"
        )
        if not col_exists:
            await conn.execute("ALTER TABLE equipment ADD COLUMN name TEXT")
            logger.info("Added 'name' column to equipment table")
        else:
            logger.info("equipment.name column already exists")

        # Now grant update on equipment.name (safe to run even if column just created)
        grants.append(f"GRANT UPDATE (name) ON equipment TO {cfg.ui_user}")

        for sql in grants:
            await conn.execute(sql)
        logger.info("Permissions granted to %s", cfg.ui_user)

    finally:
        await conn.close()
