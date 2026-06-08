# Copyright (c) 2026 ООО «НГ-ЭНЕРГОСЕРВИС». Все права защищены.
# Программный комплекс «Честная Генерация»
# Модуль веб-дашборда и визуализации телеметрии
# Автор: Саввиди Александр Анатольевич | ИНН 4725009270
#
# Данное программное обеспечение является конфиденциальным.
# Несанкционированное копирование, распространение или использование
# без письменного разрешения правообладателя запрещено.

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class FaultItem(BaseModel):
    bit: int
    name: str
    severity: str  # warning / derate / shutdown / shutdown_cooldown / none / unknown


class RegisterOut(BaseModel):
    addr: int
    name: Optional[str] = None
    name_en: Optional[str] = None
    value: Optional[float] = None
    raw: Optional[int] = None
    text: Optional[str] = None
    unit: Optional[str] = None
    reason: Optional[str] = None
    ts: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    notes_ru: Optional[str] = None
    faults: Optional[list[FaultItem]] = None
