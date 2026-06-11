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

import { PANEL_BOX } from "./registers";

interface Props {
  label: string;
  value: string;
  /** единица измерения — приглушённым серым, как в блоках параметров */
  unit?: string;
  /** active — зелёные «ЖК-цифры», idle — серые, crit — красные */
  tone?: "active" | "idle" | "crit";
  /** широкий межбуквенный интервал (одометр) */
  wide?: boolean;
}

/** Цифровое окошко панели (напряжение, моточасы, обороты) */
export default function DigitalWindow({ label, value, unit, tone = "active", wide }: Props) {
  const toneCls =
    tone === "crit"
      ? "text-red-400"
      : tone === "idle"
        ? "text-muted-foreground"
        : "text-green-500 dark:text-green-400";

  return (
    <div className={`flex items-center justify-between px-3 py-2 ${PANEL_BOX}`}>
      <span className="text-[9px] tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span
        className={`font-mono text-[15px] tabular-nums ${toneCls} ${wide ? "tracking-[0.1em]" : ""}`}
      >
        {value}
        {unit && (
          <span className="text-[10px] text-muted-foreground"> {unit}</span>
        )}
      </span>
    </div>
  );
}
