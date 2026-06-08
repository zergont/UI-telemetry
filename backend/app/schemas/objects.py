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


class ObjectOut(BaseModel):
    router_sn: str
    name: Optional[str] = None
    notes: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    equipment_count: int = 0
    status: str = "OFFLINE"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    total_installed_power_kw: Optional[float] = None
    total_load_kw: Optional[float] = None


class ObjectNameUpdate(BaseModel):
    name: str
