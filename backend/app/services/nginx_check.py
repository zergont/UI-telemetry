"""Проверка доступности nginx при старте бэкенда."""
from __future__ import annotations

import logging
import socket
import ssl
from urllib.parse import urlparse

logger = logging.getLogger("cg.nginx")


def check_nginx(public_base_url: str) -> bool:
    """
    Проверяет, слушает ли что-нибудь на адресе public_base_url.
    Возвращает True если порт открыт (nginx работает).
    """
    parsed = urlparse(public_base_url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)

    # Для проверки внешнего домена используем 127.0.0.1
    # (nginx слушает локально, домен резолвится на другой IP через NAT)
    check_host = "127.0.0.1"

    try:
        sock = socket.create_connection((check_host, port), timeout=2)
        # Если https — пробуем TLS handshake
        if parsed.scheme == "https":
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            sock = ctx.wrap_socket(sock, server_hostname=host)
        sock.close()
        return True
    except (ConnectionRefusedError, TimeoutError, OSError):
        return False


def log_nginx_status(public_base_url: str) -> None:
    """Проверяет nginx и логирует результат."""
    parsed = urlparse(public_base_url)
    port = parsed.port or (443 if parsed.scheme == "https" else 80)

    if check_nginx(public_base_url):
        logger.info("nginx доступен на порту %s — внешний доступ настроен", port)
    else:
        logger.warning(
            "nginx НЕ ДОСТУПЕН на порту %s. "
            "Внешний доступ через %s не будет работать.",
            port,
            public_base_url,
        )
        logger.warning(
            "Для настройки nginx см. deploy/cg-dashboard-nginx.conf "
            "или README.md раздел 'Продакшн'"
        )
