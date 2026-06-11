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

const LABELS = ["A", "B", "C"] as const;

interface Props {
  /** Токи фаз L1/L2/L3, А */
  currents: (number | null)[];
  /** Номинальный ток фазы, А */
  nominalA: number | null;
}

/**
 * Цвет столбика: чистый зелёный до 70% номинала, дальше градиент в красный,
 * свыше 100% — бордовый. Яркость по рангу: максимальный ток светлее,
 * минимальный темнее; разрыв яркости пропорционален перекосу фаз.
 */
function barColor(pct: number, rank: -1 | 0 | 1, spreadPct: number): string {
  if (pct > 1) return "#7f1d1d";
  const hue = pct <= 0.7 ? 145 : 145 * (1 - (pct - 0.7) / 0.3);
  const delta = Math.min(16, Math.max(3, spreadPct * 120));
  const light = 38 + rank * delta;
  return `hsl(${Math.max(0, hue).toFixed(0)}, 62%, ${light.toFixed(0)}%)`;
}

/** Перекос фаз свыше 8% от номинала — фаза с максимальным током пульсирует */
const SKEW_ALARM_PCT = 0.08;

/** Токи фаз вертикальными столбиками («эквалайзер») */
export default function PhaseBars({ currents, nominalA }: Props) {
  const valid = currents.filter((c): c is number => c != null);
  const max = valid.length ? Math.max(...valid) : null;
  const min = valid.length ? Math.min(...valid) : null;
  const spreadPct =
    max != null && min != null && nominalA ? (max - min) / nominalA : 0;
  const skewAlarm = spreadPct > SKEW_ALARM_PCT;

  return (
    <div className={`flex h-full w-full items-stretch gap-2.5 px-3 pb-2 pt-2.5 ${PANEL_BOX}`}>
      {LABELS.map((label, i) => {
        const value = currents[i];
        const pct =
          value != null && nominalA && nominalA > 0 ? value / nominalA : null;
        const rank: -1 | 0 | 1 =
          value == null || max == null || min == null || max === min
            ? 0
            : value === max
              ? 1
              : value === min
                ? -1
                : 0;
        const height =
          pct != null ? Math.max(3, Math.min(pct, 1.08) * 100) : 2;
        const color =
          pct != null ? barColor(pct, rank, spreadPct) : "var(--muted)";

        return (
          <div key={label} className="flex min-h-12 flex-1 flex-col text-center">
            <div className="flex flex-1 items-end">
              <div
                className={`w-full rounded-t-[3px] ${
                  skewAlarm && rank === 1 ? "animate-pulse" : ""
                }`}
                style={{
                  height: `${height}%`,
                  background: color,
                  transition: "height 0.5s ease, background 0.5s ease",
                }}
              />
            </div>
            <span className="font-mono text-[11px] tabular-nums text-foreground/90">
              {value != null ? Math.round(value) : "—"}
            </span>
            <span className="block text-[9px] text-muted-foreground">
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
