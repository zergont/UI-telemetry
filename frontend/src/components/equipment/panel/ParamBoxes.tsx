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

import type { ReactNode } from "react";
import { PANEL_BOX, STATE_CLASSES, type ParamState } from "./registers";

interface StatBoxProps {
  icon: ReactNode;
  value: number | null;
  unit: string;
  decimals?: number;
  state: ParamState;
  /** Готовая строка значения вместо числа (например, форматированные моточасы) */
  text?: string;
}

/**
 * Короткая плашка: иконка слева + значение + единица, без подписи.
 * Единый формат для напряжения, масла, ОЖ, АКБ, оборотов.
 */
export function StatBox({ icon, value, unit, decimals = 0, state, text }: StatBoxProps) {
  const cls = STATE_CLASSES[state];
  const shown = text ?? (value != null ? value.toFixed(decimals) : "—");
  return (
    <div
      className={`flex flex-1 items-center gap-2.5 px-3 py-2 ${PANEL_BOX} ${cls.box}`}
    >
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center ${cls.icon}`}>
        {icon}
      </span>
      <span className={`font-mono text-[15px] leading-none tabular-nums ${cls.value}`}>
        {shown}
        {unit && <span className="text-[10px] text-muted-foreground"> {unit}</span>}
      </span>
    </div>
  );
}

interface StatBarProps {
  label: string;
  value: string;
  state?: ParamState;
}

/**
 * Длинная плашка: лейбл слева, моноширинное значение справа.
 * Для параметров-«табло» без иконки (моточасы).
 */
export function StatBar({ label, value, state = "ok" }: StatBarProps) {
  const cls = STATE_CLASSES[state];
  // «Табло»: зелёное моноширинное при норме, цвет тревоги при отклонении
  const valueCls =
    state === "warn" || state === "crit"
      ? cls.value
      : state === "idle"
        ? "text-muted-foreground"
        : "text-green-500 dark:text-green-400";
  return (
    <div
      className={`flex items-center justify-between px-3.5 py-2.5 ${PANEL_BOX} ${cls.box}`}
    >
      <span className="text-[10px] tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className={`font-mono text-[15px] tracking-[0.08em] tabular-nums ${valueCls}`}>
        {value}
      </span>
    </div>
  );
}
