# Copyright (c) 2026 ООО «НГ-ЭНЕРГОСЕРВИС». Все права защищены.
# Программный комплекс «Честная Генерация»
# Модуль веб-дашборда и визуализации телеметрии
# Автор: Саввиди Александр Анатольевич | ИНН 4725009270
#
# Данное программное обеспечение является конфиденциальным.
# Несанкционированное копирование, распространение или использование
# без письменного разрешения правообладателя запрещено.

"""ShareLinkService — создание, валидация, отзыв share-ссылок.

Токены хранятся в БД как SHA-256 хэши.
Cookie подписывается через itsdangerous (session_secret из config.yaml).
"""
from __future__ import annotations

import fnmatch
import hashlib
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg
from itsdangerous import BadSignature, TimestampSigner, URLSafeTimedSerializer

from app.config import AccessConfig


# ---------------------------------------------------------------------------
# Token hashing
# ---------------------------------------------------------------------------

def _hash_token(token: str) -> str:
    """SHA-256 хэш токена (в БД храним только хэш)."""
    return hashlib.sha256(token.encode()).hexdigest()


def generate_token() -> str:
    """Генерация криптографически стойкого токена."""
    return secrets.token_urlsafe(32)


# ---------------------------------------------------------------------------
# Cookie signer (itsdangerous)
# ---------------------------------------------------------------------------

def get_serializer(secret: str) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(secret, salt="cg-share-session")


def create_session_cookie(
    secret: str,
    link_id: int,
    role: str,
    scope_type: str,
    scope_id: str | None,
) -> str:
    """Подписать данные сессии в cookie-значение."""
    s = get_serializer(secret)
    return s.dumps({
        "v": 1,
        "link_id": link_id,
        "role": role,
        "scope_type": scope_type,
        "scope_id": scope_id,
    })


def decode_session_cookie(
    secret: str,
    cookie_value: str,
    max_age: int,
) -> dict | None:
    """Расшифровать и проверить подпись cookie. Вернуть None если невалидно."""
    s = get_serializer(secret)
    try:
        data = s.loads(cookie_value, max_age=max_age)
        if not isinstance(data, dict) or data.get("v") != 1:
            return None
        return data
    except (BadSignature, Exception):
        return None


# ---------------------------------------------------------------------------
# Scope resolution: список серийников / имён / масок → set[router_sn]
# ---------------------------------------------------------------------------

# Кэш списка объектов для разворачивания масок (резолвится на каждый запрос)
_objects_cache: dict[str, Any] = {"ts": 0.0, "rows": []}
_OBJECTS_CACHE_TTL = 30.0


async def _objects_for_scope(pool: asyncpg.Pool) -> list[tuple[str, str]]:
    now = time.monotonic()
    if now - _objects_cache["ts"] > _OBJECTS_CACHE_TTL:
        rows = await pool.fetch(
            "SELECT router_sn, COALESCE(name, '') AS name FROM objects"
        )
        _objects_cache["rows"] = [(r["router_sn"], r["name"]) for r in rows]
        _objects_cache["ts"] = now
    return _objects_cache["rows"]


def _pattern_matches(pattern: str, router_sn: str, name: str) -> bool:
    p = pattern.casefold()
    if fnmatch.fnmatchcase(router_sn.casefold(), p):
        return True
    return bool(name) and fnmatch.fnmatchcase(name.casefold(), p)


async def resolve_scope_sns(pool: asyncpg.Pool, scope_id: str) -> set[str]:
    """Развернуть scope_id ссылки в набор разрешённых router_sn.

    scope_id — значения через запятую; каждое значение:
      - точный router_sn ("6003790403")
      - точное имя объекта ("Сининда-1")
      - маска по серийнику или имени, регистронезависимо ("Сининда*", "60037*")

    Точные значения без маски попадают в набор как есть — ссылка на ещё
    не появившийся в БД объект начнёт работать сразу после его появления.
    """
    patterns = [p.strip() for p in scope_id.split(",") if p.strip()]
    if not patterns:
        return set()

    allowed = {p for p in patterns if "*" not in p and "?" not in p}
    try:
        objects = await _objects_for_scope(pool)
    except Exception:
        return allowed

    for sn, name in objects:
        for p in patterns:
            if _pattern_matches(p, sn, name):
                allowed.add(sn)
                break
    return allowed


# ---------------------------------------------------------------------------
# DB operations
# ---------------------------------------------------------------------------

async def create_share_link(
    pool: asyncpg.Pool,
    *,
    label: str = "",
    scope_type: str = "all",
    scope_id: str | None = None,
    role: str = "viewer",
    max_uses: int | None = None,
    expire_days: int = 7,
) -> dict[str, Any]:
    """Создать share-ссылку. Вернуть {id, token, ...}."""
    token = generate_token()
    token_hash = _hash_token(token)
    expires_at = datetime.now(timezone.utc) + timedelta(days=expire_days)

    row = await pool.fetchrow(
        """
        INSERT INTO share_links (token_hash, label, scope_type, scope_id, role, max_uses, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, label, scope_type, scope_id, role, max_uses, use_count,
                  created_at, expires_at, revoked_at, created_by
        """,
        token_hash, label, scope_type, scope_id, role, max_uses, expires_at,
    )
    result = dict(row)
    result["token"] = token  # Токен в открытом виде — только при создании!
    return result


async def validate_token(pool: asyncpg.Pool, token: str) -> dict | None:
    """Проверить токен: найти по хэшу, проверить revoked/expired/max_uses.

    При успехе — инкрементить use_count и вернуть данные ссылки.
    При неудаче — вернуть None.

    Семантика max_uses / use_count:
        use_count считает количество *первичных входов* по ссылке (GET /view/{token}).
        Последующие запросы в рамках сессии (по cookie) НЕ увеличивают счётчик.
        Таким образом max_uses = "сколько раз ссылку открыли", а не "сколько
        страниц просмотрели". Для MVP это корректное поведение.
    """
    token_hash = _hash_token(token)
    row = await pool.fetchrow(
        """
        SELECT id, label, scope_type, scope_id, role, max_uses, use_count,
               expires_at, revoked_at
        FROM share_links
        WHERE token_hash = $1
        """,
        token_hash,
    )
    if not row:
        return None

    now = datetime.now(timezone.utc)

    # Отозвана?
    if row["revoked_at"] is not None:
        return None

    # Просрочена?
    if row["expires_at"] and row["expires_at"] < now:
        return None

    # Лимит использований?
    if row["max_uses"] is not None and row["use_count"] >= row["max_uses"]:
        return None

    # Инкрементим use_count
    await pool.execute(
        "UPDATE share_links SET use_count = use_count + 1 WHERE id = $1",
        row["id"],
    )

    return dict(row)


async def validate_link_by_id(pool: asyncpg.Pool, link_id: int) -> dict | None:
    """Проверить ссылку по ID (для валидации cookie на каждый запрос).

    НЕ инкрементит use_count — это проверка существующей сессии,
    а не новый вход по ссылке. См. docstring validate_token() про семантику.
    """
    row = await pool.fetchrow(
        """
        SELECT id, scope_type, scope_id, role, max_uses, use_count,
               expires_at, revoked_at
        FROM share_links
        WHERE id = $1
        """,
        link_id,
    )
    if not row:
        return None

    now = datetime.now(timezone.utc)

    if row["revoked_at"] is not None:
        return None
    if row["expires_at"] and row["expires_at"] < now:
        return None
    if row["max_uses"] is not None and row["use_count"] >= row["max_uses"]:
        return None

    return dict(row)


async def revoke_link(pool: asyncpg.Pool, link_id: int) -> bool:
    """Отозвать ссылку. Возвращает True если нашли и отозвали."""
    result = await pool.execute(
        """
        UPDATE share_links SET revoked_at = now()
        WHERE id = $1 AND revoked_at IS NULL
        """,
        link_id,
    )
    return result == "UPDATE 1"


async def list_links(pool: asyncpg.Pool) -> list[dict]:
    """Получить все ссылки для админ-панели (без token_hash)."""
    rows = await pool.fetch(
        """
        SELECT id, label, scope_type, scope_id, role, max_uses, use_count,
               created_at, expires_at, revoked_at, created_by
        FROM share_links
        ORDER BY created_at DESC
        """
    )
    return [dict(r) for r in rows]
