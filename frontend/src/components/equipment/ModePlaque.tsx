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

import { Cog } from "lucide-react";
import { PANEL_BOX } from "./panel/registers";
import type { MachineAnalytics } from "@/hooks/use-analytics";

/** Цвета по run_state — та же палитра, что у плашек календаря */
const TINT: Record<number, { icon: string; label: string }> = {
  0: { icon: "text-slate-400", label: "text-slate-300" },
  1: { icon: "text-yellow-400", label: "text-yellow-300" },
  2: { icon: "text-yellow-400", label: "text-yellow-300" },
  3: { icon: "text-green-500", label: "text-green-400" },
  4: { icon: "text-orange-400", label: "text-orange-300" },
  5: { icon: "text-sky-400", label: "text-sky-300" },
  6: { icon: "text-sky-400", label: "text-sky-300" },
};

function formatInMode(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м`;
  return `${s}с`;
}

interface Props {
  analytics?: MachineAnalytics;
  size?: "md" | "sm";
}

/** Плашка режима мотора под лампами: «Работа · 11ч 38м» (данные аналитики) */
export default function ModePlaque({ analytics, size = "md" }: Props) {
  const label = analytics?.run_state_label ?? analytics?.mode_label;
  if (!analytics || !label) return null;

  const tint =
    (analytics.run_state != null ? TINT[analytics.run_state] : undefined) ?? {
      icon: "text-muted-foreground",
      label: "text-foreground/80",
    };
  const text = size === "md" ? "text-[11px]" : "text-[10px]";
  const pad = size === "md" ? "px-3 py-1" : "px-2 py-0.5";

  return (
    <div
      className={`flex items-center justify-center gap-1.5 ${pad} ${PANEL_BOX}`}
      title="Режим работы и время в режиме (по данным аналитики)"
    >
      <Cog className={`h-3.5 w-3.5 ${tint.icon}`} />
      <span className={`${text} font-medium ${tint.label}`}>{label}</span>
      {analytics.time_in_mode_sec != null && analytics.time_in_mode_sec > 60 && (
        <span className={`${text} text-muted-foreground`}>
          · {formatInMode(analytics.time_in_mode_sec)}
        </span>
      )}
    </div>
  );
}
