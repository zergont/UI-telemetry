# Copyright (c) 2026 ООО «НГ-ЭНЕРГОСЕРВИС». Все права защищены.
# Программный комплекс «Честная Генерация»
# Модуль веб-дашборда и визуализации телеметрии
# Автор: Саввиди Александр Анатольевич | ИНН 4725009270
#
# Данное программное обеспечение является конфиденциальным.
# Несанкционированное копирование, распространение или использование
# без письменного разрешения правообладателя запрещено.

"""Структурированный access-логгер для security-событий.

Отдельный логгер 'cg.access' — легко фильтровать/перенаправить в файл.
"""
from __future__ import annotations

import logging

logger = logging.getLogger("cg.access")


def log_access(
    *,
    action: str,
    role: str,
    scope: str = "",
    client_ip: str = "",
    user_agent: str = "",
    result: str = "ok",
    detail: str = "",
) -> None:
    """Записать access-событие в структурированный лог."""
    logger.info(
        "action=%s role=%s scope=%s ip=%s ua=%s result=%s detail=%s",
        action, role, scope, client_ip, user_agent, result, detail,
    )
