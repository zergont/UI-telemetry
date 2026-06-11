/**
 * Copyright (c) 2026 ООО «НГ-ЭНЕРГОСЕРВИС». Все права защищены.
 * Программный комплекс «Честная Генерация»
 * Модуль веб-дашборда и визуализации телеметрии
 * Автор: Саввиди Александр Анатольевич | ИНН 4725009270
 *
 * Данное программное обеспечение является конфиденциальным.
 * Несанкционированное копирование, распространение или использование
 * без письменного разрешения правообладателя запрещено.
 */

import type { SeverityLevel } from "@/hooks/use-analytics";

/** Акцент карточки/панели по severity_level (4 уровня, cg-analytics v4.1.0) */
export const CARD_ACCENT: Record<
  SeverityLevel,
  { bar: string; card: string }
> = {
  норма: {
    bar: "via-emerald-500/60",
    card: "hover:border-emerald-500/25 hover:shadow-emerald-500/10",
  },
  внимание: {
    bar: "via-yellow-400/80",
    card: "border-yellow-500/25 shadow-yellow-500/5 hover:border-yellow-500/40 hover:shadow-yellow-500/15",
  },
  предупреждение: {
    bar: "via-orange-500/80",
    card: "border-orange-500/30 shadow-orange-500/5 hover:border-orange-500/45 hover:shadow-orange-500/20",
  },
  авария: {
    bar: "via-red-500/80",
    card: "border-red-500/30 shadow-red-500/10 hover:border-red-500/50 hover:shadow-red-500/25",
  },
};
