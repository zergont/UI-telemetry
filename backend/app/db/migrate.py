"""One-time idempotent migrations run on startup using admin credentials.

Creates the cg_ui database user, grants appropriate permissions,
and adds the equipment.name column for aliases.

NOTE: If cg_writer doesn't have CREATEROLE privilege, the cg_ui user
must be created manually by a superuser (see README).
"""
from __future__ import annotations

import asyncio
import logging

import asyncpg

from app.config import DatabaseConfig

logger = logging.getLogger(__name__)


async def run_migrations(cfg: DatabaseConfig) -> None:
    try:
        conn: asyncpg.Connection = await asyncio.wait_for(
            asyncpg.connect(
                host=cfg.host,
                port=cfg.port,
                database=cfg.name,
                user=cfg.admin_user,
                password=cfg.admin_password,
            ),
            timeout=5,
        )
    except Exception as exc:
        logger.warning("Не удалось подключиться для миграции: %s", exc)
        return

    try:
        # 1. Create cg_ui role if not exists
        exists = await conn.fetchval(
            "SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1",
            cfg.ui_user,
        )
        if not exists:
            try:
                await conn.execute(
                    f"CREATE ROLE {cfg.ui_user} WITH LOGIN PASSWORD '{cfg.ui_password}'"
                )
                logger.info("Создан пользователь БД: %s", cfg.ui_user)
            except asyncpg.InsufficientPrivilegeError:
                logger.warning(
                    "Нет прав для создания роли %s. "
                    "Создайте вручную: sudo -u postgres psql -d %s -c "
                    "\"CREATE ROLE %s WITH LOGIN PASSWORD '%s';\"",
                    cfg.ui_user, cfg.name, cfg.ui_user, cfg.ui_password,
                )
        else:
            logger.info("Пользователь %s уже существует", cfg.ui_user)

        # 2. Grant permissions (only if cg_ui exists)
        ui_exists = await conn.fetchval(
            "SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1",
            cfg.ui_user,
        )
        if ui_exists:
            grants = [
                f"GRANT CONNECT ON DATABASE {cfg.name} TO {cfg.ui_user}",
                f"GRANT USAGE ON SCHEMA public TO {cfg.ui_user}",
                f"GRANT SELECT ON ALL TABLES IN SCHEMA public TO {cfg.ui_user}",
                f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO {cfg.ui_user}",
            ]

            # Grant UPDATE on objects.name/notes if table exists
            obj_exists = await conn.fetchval(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = 'objects'"
            )
            if obj_exists:
                grants.append(f"GRANT UPDATE (name, notes) ON objects TO {cfg.ui_user}")

            for sql in grants:
                try:
                    await conn.execute(sql)
                except asyncpg.InsufficientPrivilegeError:
                    logger.warning("Нет прав для выполнения: %s", sql)

            logger.info("Права выданы для %s", cfg.ui_user)

        # 3. Add equipment.name column if not exists
        eq_exists = await conn.fetchval(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'equipment'"
        )
        if eq_exists:
            col_exists = await conn.fetchval(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'equipment' AND column_name = 'name'"
            )
            if not col_exists:
                try:
                    await conn.execute("ALTER TABLE equipment ADD COLUMN name TEXT")
                    logger.info("Добавлена колонка 'name' в таблицу equipment")
                except asyncpg.InsufficientPrivilegeError:
                    logger.warning(
                        "Нет прав для добавления колонки. Выполните вручную: "
                        "ALTER TABLE equipment ADD COLUMN name TEXT;"
                    )
            else:
                logger.info("Колонка equipment.name уже существует")

            # Grant update on equipment.name
            if ui_exists and col_exists:
                try:
                    await conn.execute(
                        f"GRANT UPDATE (name) ON equipment TO {cfg.ui_user}"
                    )
                except asyncpg.InsufficientPrivilegeError:
                    pass

    finally:
        await conn.close()
