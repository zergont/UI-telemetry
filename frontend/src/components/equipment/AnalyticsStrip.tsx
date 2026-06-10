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

import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Flame, ChevronRight } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatRelativeTime } from "@/lib/format";
import type { MachineAnalytics, SeverityLevel } from "@/hooks/use-analytics";

interface SeverityMeta {
  label: string;
  text: string;
  iconBg: string;
  dot: string;
  pulse: boolean;
}

/** 4-уровневая градация (cg-analytics v4.1.0): панель важнее аналитики */
const SEVERITY_META: Record<SeverityLevel, SeverityMeta> = {
  норма: {
    label: "Норма",
    text: "text-emerald-500",
    iconBg: "bg-emerald-500/10",
    dot: "bg-emerald-500",
    pulse: false,
  },
  внимание: {
    label: "Внимание",
    text: "text-yellow-500",
    iconBg: "bg-yellow-500/10",
    dot: "bg-yellow-400",
    pulse: true,
  },
  предупреждение: {
    label: "Предупреждение",
    text: "text-orange-500",
    iconBg: "bg-orange-500/10",
    dot: "bg-orange-400",
    pulse: true,
  },
  авария: {
    label: "Авария",
    text: "text-red-500",
    iconBg: "bg-red-500/10",
    dot: "bg-red-500",
    pulse: true,
  },
};

const COKING_META = {
  YELLOW: {
    text: "text-amber-500",
    bg: "bg-amber-500/10",
    hint: "Риск закоксовки форсунок: повышенный",
  },
  RED: {
    text: "text-red-500",
    bg: "bg-red-500/10",
    hint: "Риск закоксовки форсунок: высокий",
  },
} as const;

interface Props {
  analytics: MachineAnalytics;
  /** Открыть календарь истории аналитики; строка становится кликабельной */
  onOpenCalendar?: () => void;
}

/** Нижняя строка карточки ДГУ: живая сводка ИИ-аналитики из cg-analytics. */
export default function AnalyticsStrip({ analytics, onOpenCalendar }: Props) {
  const severity = analytics.severity_level ?? "норма";
  const meta = SEVERITY_META[severity] ?? SEVERITY_META["норма"];
  const coking =
    analytics.coking_risk === "YELLOW" || analytics.coking_risk === "RED"
      ? COKING_META[analytics.coking_risk]
      : null;

  return (
    <div
      className={`group/strip border-t border-border/60 px-6 pt-3 -mt-2 ${
        onOpenCalendar
          ? "-mb-6 cursor-pointer rounded-b-xl pb-6 transition-colors hover:bg-accent/40"
          : ""
      }`}
      role={onOpenCalendar ? "button" : undefined}
      title={onOpenCalendar ? "История аналитики" : undefined}
      onClick={
        onOpenCalendar
          ? (e) => {
              e.stopPropagation();
              onOpenCalendar();
            }
          : undefined
      }
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${meta.iconBg}`}
        >
          <Sparkles className={`h-3 w-3 ${meta.text}`} />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          ИИ-аналитика
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot} ${
              meta.pulse ? "animate-pulse" : ""
            }`}
          />
          <span className={`text-[11px] font-medium ${meta.text}`}>
            {meta.label}
          </span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          {coking && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={`flex h-5 w-5 cursor-help items-center justify-center rounded-full ${coking.bg}`}
                >
                  <Flame className={`h-3 w-3 ${coking.text}`} />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{coking.hint}</p>
              </TooltipContent>
            </Tooltip>
          )}
          {analytics.status_updated && (
            <span className="text-[11px] text-muted-foreground">
              {formatRelativeTime(new Date(analytics.status_updated))}
            </span>
          )}
          {onOpenCalendar && (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 transition-all group-hover/strip:translate-x-0.5 group-hover/strip:text-foreground/70" />
          )}
        </span>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={analytics.status_text ?? "pending"}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="mt-2 line-clamp-2 text-xs leading-relaxed text-foreground/75"
        >
          {analytics.status_text ??
            "Наблюдение запущено, ожидание первой сводки…"}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
