"""Аутентификация и авторизация.

Приоритет определения роли: LAN IP → cookie → bearer token.

AuthContext — результат аутентификации, доступен через Depends(get_auth_context).
"""
from __future__ import annotations

import ipaddress
import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from fastapi import Cookie, Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import AccessConfig, Settings, get_settings
from app.services.access_log import log_access
from app.services.share_links import decode_session_cookie, validate_link_by_id

if TYPE_CHECKING:
    import asyncpg

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)

# Имя cookie для share-сессий
COOKIE_NAME = "cg_session"


# ---------------------------------------------------------------------------
# AuthContext — результат аутентификации
# ---------------------------------------------------------------------------

@dataclass
class AuthContext:
    role: str = "anonymous"           # "admin" | "viewer" | "anonymous"
    method: str = "none"              # "lan" | "cookie" | "bearer" | "none"
    scope_type: str = "all"           # "all" | "site" | "device"
    scope_id: str | None = None       # router_sn для scope_type=site
    link_id: int | None = None        # ID share_links (если cookie)
    client_ip: str = ""
    allowed_router_sns: set[str] | None = None  # None = все разрешены

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def is_authenticated(self) -> bool:
        return self.role != "anonymous"


# ---------------------------------------------------------------------------
# IP helpers
# ---------------------------------------------------------------------------

def _get_client_ip(request: Request, access_cfg: AccessConfig) -> str:
    """Определить реальный IP клиента с учётом trusted proxy."""
    client_ip = request.client.host if request.client else "0.0.0.0"

    # Если запрос пришёл от trusted proxy — берём X-Real-IP
    if client_ip in access_cfg.trusted_proxy_ips:
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip
        # Fallback на X-Forwarded-For (первый IP)
        xff = request.headers.get("X-Forwarded-For")
        if xff:
            return xff.split(",")[0].strip()

    return client_ip


def _is_lan_ip(ip_str: str, subnets: list[str]) -> bool:
    """Проверить, попадает ли IP в LAN-подсети."""
    try:
        addr = ipaddress.ip_address(ip_str)
        for subnet_str in subnets:
            if addr in ipaddress.ip_network(subnet_str, strict=False):
                return True
    except ValueError:
        pass
    return False


# ---------------------------------------------------------------------------
# get_auth_context — единая точка аутентификации для REST
# ---------------------------------------------------------------------------

async def get_auth_context(
    request: Request,
    settings: Settings = Depends(get_settings),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AuthContext:
    """Определить роль пользователя. Приоритет: LAN IP → cookie → bearer."""
    access_cfg = settings.access
    client_ip = _get_client_ip(request, access_cfg)

    # 1. LAN admin — по IP-адресу
    if _is_lan_ip(client_ip, access_cfg.lan_subnets):
        log_access(
            action="auth", role="admin", scope="all",
            client_ip=client_ip, result="ok", detail="lan",
        )
        return AuthContext(
            role="admin", method="lan", scope_type="all",
            client_ip=client_ip,
        )

    # 2. Cookie (share-link session)
    cookie_value = request.cookies.get(COOKIE_NAME)
    if cookie_value:
        data = decode_session_cookie(
            access_cfg.session_secret,
            cookie_value,
            access_cfg.session_max_age_sec,
        )
        if data and data.get("link_id"):
            # Проверяем ссылку в БД (мгновенный revoke)
            pool = request.app.state.db_pool
            if pool:
                link = await validate_link_by_id(pool, data["link_id"])
                if link:
                    scope_type = link.get("scope_type", "all")
                    scope_id = link.get("scope_id")
                    allowed = None
                    if scope_type == "site" and scope_id:
                        allowed = {scope_id}

                    log_access(
                        action="auth", role=link["role"],
                        scope=f"{scope_type}:{scope_id or '*'}",
                        client_ip=client_ip, result="ok", detail="cookie",
                    )
                    return AuthContext(
                        role=link["role"],
                        method="cookie",
                        scope_type=scope_type,
                        scope_id=scope_id,
                        link_id=data["link_id"],
                        client_ip=client_ip,
                        allowed_router_sns=allowed,
                    )

    # 3. Bearer token (read-only viewer для интеграций)
    if credentials and credentials.credentials:
        if credentials.credentials == settings.auth.token:
            log_access(
                action="auth", role="viewer", scope="all",
                client_ip=client_ip, result="ok", detail="bearer",
            )
            return AuthContext(
                role="viewer", method="bearer", scope_type="all",
                client_ip=client_ip,
            )

    # Не авторизован
    log_access(
        action="auth", role="anonymous", scope="",
        client_ip=client_ip, result="denied", detail="no_credentials",
    )
    return AuthContext(role="anonymous", method="none", client_ip=client_ip)


# ---------------------------------------------------------------------------
# Dependencies для роутеров
# ---------------------------------------------------------------------------

async def require_auth(
    ctx: AuthContext = Depends(get_auth_context),
) -> AuthContext:
    """Требует любую аутентификацию (admin или viewer)."""
    if not ctx.is_authenticated:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    return ctx


async def require_admin(
    ctx: AuthContext = Depends(get_auth_context),
) -> AuthContext:
    """Требует роль admin (LAN)."""
    if not ctx.is_authenticated:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    if not ctx.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return ctx


# ---------------------------------------------------------------------------
# WS аутентификация
# ---------------------------------------------------------------------------

async def get_ws_auth_context(
    websocket_or_request,
    settings: Settings,
    token: str = "",
    cookie_value: str = "",
) -> AuthContext:
    """Определить роль для WebSocket-подключения.

    WS не поддерживает Depends напрямую — вызывается вручную.
    """
    access_cfg = settings.access
    client_host = "0.0.0.0"
    if hasattr(websocket_or_request, "client") and websocket_or_request.client:
        client_host = websocket_or_request.client.host

    # Trusted proxy для WS
    if client_host in access_cfg.trusted_proxy_ips:
        real_ip = (
            websocket_or_request.headers.get("X-Real-IP")
            or (websocket_or_request.headers.get("X-Forwarded-For", "").split(",")[0].strip())
        )
        if real_ip:
            client_host = real_ip

    # 1. LAN
    if _is_lan_ip(client_host, access_cfg.lan_subnets):
        return AuthContext(role="admin", method="lan", scope_type="all", client_ip=client_host)

    # 2. Cookie
    if cookie_value:
        data = decode_session_cookie(
            access_cfg.session_secret, cookie_value, access_cfg.session_max_age_sec,
        )
        if data and data.get("link_id"):
            pool = websocket_or_request.app.state.db_pool
            if pool:
                link = await validate_link_by_id(pool, data["link_id"])
                if link:
                    scope_type = link.get("scope_type", "all")
                    scope_id = link.get("scope_id")
                    allowed = None
                    if scope_type == "site" and scope_id:
                        allowed = {scope_id}
                    return AuthContext(
                        role=link["role"], method="cookie",
                        scope_type=scope_type, scope_id=scope_id,
                        link_id=data["link_id"], client_ip=client_host,
                        allowed_router_sns=allowed,
                    )

    # 3. Bearer token (через query param)
    if token and token == settings.auth.token:
        return AuthContext(role="viewer", method="bearer", scope_type="all", client_ip=client_host)

    return AuthContext(role="anonymous", method="none", client_ip=client_host)
