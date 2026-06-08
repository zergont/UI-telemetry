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

import { Badge } from "@/components/ui/badge";
import type { RegisterValue } from "@/stores/telemetry-store";
import StatusBadge from "./StatusBadge";

// ── 40010 Режим управления ─────────────────────────────────────────────────
const MODE_META: Record<number, { label: string; className: string }> = {
  0: { label: "Откл.",   className: "bg-slate-500/15  text-slate-400   border-slate-500/20"  },
  1: { label: "Авто",    className: "bg-blue-500/15   text-blue-400    border-blue-500/20"   },
  2: { label: "Ручной",  className: "bg-amber-500/15  text-amber-400   border-amber-500/20"  },
};

// ── 40011 Состояние двигателя ──────────────────────────────────────────────
const STATE_META: Record<number, { label: string; className: string; pulse?: boolean }> = {
  0: { label: "Стоп",            className: "bg-slate-500/15  text-slate-400   border-slate-500/20"  },
  1: { label: "Задержка пуска",  className: "bg-yellow-500/15 text-yellow-400  border-yellow-500/20", pulse: true },
  2: { label: "Прогрев",         className: "bg-yellow-500/15 text-yellow-400  border-yellow-500/20", pulse: true },
  3: { label: "Работа",          className: "bg-green-500/15  text-green-500   border-green-500/20",  pulse: true },
  4: { label: "Охлаждение",      className: "bg-yellow-500/15 text-yellow-400  border-yellow-500/20", pulse: true },
  5: { label: "Охлаждение ХХ",   className: "bg-yellow-500/15 text-yellow-400  border-yellow-500/20", pulse: true },
  6: { label: "Переход на ХХ",   className: "bg-yellow-500/15 text-yellow-400  border-yellow-500/20", pulse: true },
};

// ── 40013 Индикация аварии ─────────────────────────────────────────────────
const ALARM_META: Record<number, { label: string; className: string; pulse?: boolean } | null> = {
  0: null, // None — не показываем
  1: { label: "⚠ Предупреждение",    className: "bg-yellow-500/15 text-yellow-400  border-yellow-500/20", pulse: true },
  2: { label: "⚠ Снижение мощн.",    className: "bg-orange-500/15 text-orange-400  border-orange-500/20", pulse: true },
  3: { label: "✖ Стоп с охл.",       className: "bg-red-500/15    text-red-500     border-red-500/20",    pulse: true },
  4: { label: "✖ Аварийный стоп",    className: "bg-red-500/15    text-red-500     border-red-500/20",    pulse: true },
};

function getRaw(reg: RegisterValue | undefined): number | null {
  if (!reg) return null;
  if (reg.raw === 65535 || reg.raw === 32767) return null;
  return reg.raw;
}

interface Props {
  liveRegs: Map<number, RegisterValue> | undefined;
  /** true — данные живые (<30 с), false — показываем fallback */
  panelFresh: boolean;
  /** ONLINE / DELAY / OFFLINE — для fallback-бейджа */
  fallbackStatus: string;
}

export default function EngineStatusBadges({ liveRegs, panelFresh, fallbackStatus }: Props) {
  const modeRaw  = getRaw(liveRegs?.get(40010));
  const stateRaw = getRaw(liveRegs?.get(40011));
  const alarmRaw = getRaw(liveRegs?.get(40013));

  // Если нет живых данных или нет нужных регистров — старый бейдж
  if (!panelFresh || stateRaw === null) {
    return <StatusBadge status={fallbackStatus} />;
  }

  const modeMeta  = modeRaw  !== null ? MODE_META[modeRaw]   : undefined;
  const stateMeta = STATE_META[stateRaw] ?? { label: String(stateRaw), className: "bg-slate-500/15 text-slate-400 border-slate-500/20" };
  const alarmMeta = alarmRaw !== null ? ALARM_META[alarmRaw] ?? null : null;

  return (
    <div className="flex flex-col items-end gap-1">
      {/* Режим управления */}
      {modeMeta && (
        <Badge variant="outline" className={modeMeta.className}>
          {modeMeta.label}
        </Badge>
      )}
      {/* Состояние двигателя */}
      <Badge variant="outline" className={stateMeta.className}>
        {stateMeta.pulse && (
          <span className={`mr-1.5 inline-block h-2 w-2 rounded-full animate-pulse ${
            stateMeta.className.includes("green") ? "bg-green-500" :
            stateMeta.className.includes("yellow") ? "bg-yellow-400" : "bg-slate-400"
          }`} />
        )}
        {stateMeta.label}
      </Badge>
      {/* Авария — только если не None */}
      {alarmMeta && (
        <Badge variant="outline" className={alarmMeta.className}>
          {alarmMeta.pulse && (
            <span className={`mr-1.5 inline-block h-2 w-2 rounded-full animate-pulse ${
              alarmMeta.className.includes("red") ? "bg-red-500" :
              alarmMeta.className.includes("orange") ? "bg-orange-400" : "bg-yellow-400"
            }`} />
          )}
          {alarmMeta.label}
        </Badge>
      )}
    </div>
  );
}
