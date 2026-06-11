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
 * Цвет столбика: градиент зелёный → красный по % от номинала, свыше 100% — бордовый.
 * Яркость по рангу: максимальный ток светлее, минимальный темнее;
 * разрыв яркости пропорционален перекосу фаз.
 */
function barColor(pct: number, rank: -1 | 0 | 1, spreadPct: number): string {
  if (pct > 1) return "#7f1d1d";
  const hue = 145 * (1 - Math.min(pct, 1));
  const delta = Math.min(12, Math.max(2, spreadPct * 60));
  const light = 38 + rank * delta;
  return `hsl(${hue.toFixed(0)}, 62%, ${light.toFixed(0)}%)`;
}

/** Токи фаз вертикальными столбиками («эквалайзер») */
export default function PhaseBars({ currents, nominalA }: Props) {
  const valid = currents.filter((c): c is number => c != null);
  const max = valid.length ? Math.max(...valid) : null;
  const min = valid.length ? Math.min(...valid) : null;
  const spreadPct =
    max != null && min != null && nominalA ? (max - min) / nominalA : 0;

  return (
    <div className={`flex items-end gap-2.5 px-3 pb-2 pt-2.5 ${PANEL_BOX}`}>
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
          <div key={label} className="flex-1 text-center">
            <div className="flex h-12 items-end">
              <div
                className="w-full rounded-t-[3px]"
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
            <span className="block text-[8px] text-muted-foreground/70">
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
