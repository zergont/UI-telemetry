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
import {
  PANEL_BOX,
  STATE_CLASSES,
  oilPressState,
  oilTempState,
  type ParamState,
} from "./registers";
import { OilCanIcon } from "./PanelIcons";

const STATE_RANK: Record<ParamState, number> = { idle: 0, ok: 1, warn: 2, crit: 3 };

function worst(a: ParamState, b: ParamState): ParamState {
  return STATE_RANK[a] >= STATE_RANK[b] ? a : b;
}

function Value({
  value,
  unit,
  decimals = 0,
  cls,
}: {
  value: number | null;
  unit: string;
  decimals?: number;
  cls: string;
}) {
  return (
    <span className={`font-mono text-[13px] tabular-nums ${cls}`}>
      {value != null ? value.toFixed(decimals) : "—"}
      <span className="text-[9px] text-muted-foreground"> {unit}</span>
    </span>
  );
}

interface OilBoxProps {
  pressKpa: number | null;
  tempC: number | null;
  running: boolean;
}

/** Маслёнка: давление слева, температура справа, цвет иконки — по худшему параметру */
export function OilBox({ pressKpa, tempC, running }: OilBoxProps) {
  const pressState = oilPressState(pressKpa, running);
  const tempState = oilTempState(tempC, running);
  const iconState = worst(pressState, tempState);
  const cls = STATE_CLASSES[iconState];

  return (
    <div className={`flex items-center px-3 py-2 ${PANEL_BOX} ${cls.box}`}>
      <span className="flex-1 text-center">
        <Value value={pressKpa} unit="кПа" cls={STATE_CLASSES[pressState].value} />
      </span>
      <OilCanIcon className={`h-[26px] w-[26px] shrink-0 ${cls.icon}`} />
      <span className="flex-1 text-center">
        <Value value={tempC} unit="°C" decimals={0} cls={STATE_CLASSES[tempState].value} />
      </span>
    </div>
  );
}

interface IconValueBoxProps {
  icon: ReactNode;
  value: number | null;
  unit: string;
  decimals?: number;
  state: ParamState;
}

/** Компактный блок «иконка + значение» (снежинка ОЖ, АКБ) */
export function IconValueBox({ icon, value, unit, decimals = 0, state }: IconValueBoxProps) {
  const cls = STATE_CLASSES[state];
  return (
    <div
      className={`flex flex-1 items-center justify-center gap-2 px-2.5 py-2 ${PANEL_BOX} ${cls.box}`}
    >
      <span className={`shrink-0 ${cls.icon}`}>{icon}</span>
      <Value value={value} unit={unit} decimals={decimals} cls={cls.value} />
    </div>
  );
}
