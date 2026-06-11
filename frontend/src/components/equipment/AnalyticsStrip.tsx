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
import { Flame, CalendarDays } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatRelativeTime } from "@/lib/format";
import type { MachineAnalytics, SeverityLevel } from "@/hooks/use-analytics";
import RobotMoodIcon from "./RobotMoodIcon";

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

const PENDING_TEXT = "Наблюдение запущено, ожидание первой сводки…";

interface Props {
  analytics: MachineAnalytics;
  /** Открыть календарь истории аналитики; строка становится кликабельной */
  onOpenCalendar?: () => void;
  /** Однострочный режим для карточки «минимал» */
  compact?: boolean;
}

/** Нижняя строка карточки ДГУ: живая сводка ИИ-аналитики из cg-analytics. */
export default function AnalyticsStrip({
  analytics,
  onOpenCalendar,
  compact = false,
}: Props) {
  const severity = analytics.severity_level ?? "норма";
  const meta = SEVERITY_META[severity] ?? SEVERITY_META["норма"];
  const coking =
    analytics.coking_risk === "YELLOW" || analytics.coking_risk === "RED"
      ? COKING_META[analytics.coking_risk]
      : null;
  const time = analytics.status_updated
    ? formatRelativeTime(new Date(analytics.status_updated))
    : null;
  const statusText = analytics.status_text ?? PENDING_TEXT;

  const clickable = onOpenCalendar
    ? `${compact ? "-mb-4 pb-4" : "-mb-5 pb-5"} cursor-pointer rounded-b-xl transition-colors hover:bg-accent/40`
    : "";

  const clickProps = onOpenCalendar
    ? {
        role: "button" as const,
        title: "История аналитики",
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          onOpenCalendar();
        },
      }
    : {};

  const cokingIcon = coking && (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-full ${coking.bg}`}
        >
          <Flame className={`h-3 w-3 ${coking.text}`} />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{coking.hint}</p>
      </TooltipContent>
    </Tooltip>
  );

  if (compact) {
    return (
      <div
        className={`group/strip mt-2.5 border-t border-border/60 px-6 pt-2 ${clickable}`}
        {...clickProps}
      >
        <div className="flex items-center gap-2">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${meta.iconBg}`}
          >
            <RobotMoodIcon severity={severity} className={`h-5 w-5 ${meta.text}`} />
          </span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={statusText}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="min-w-0 flex-1 truncate text-[11.5px] leading-snug text-foreground/75"
              title={statusText}
            >
              {statusText}
            </motion.p>
          </AnimatePresence>
          {cokingIcon}
          {time && (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {time.replace(" назад", "")}
            </span>
          )}
          {onOpenCalendar && (
            <CalendarDays className="h-5 w-5 shrink-0 text-muted-foreground/50 transition-colors group-hover/strip:text-foreground/80" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group/strip mt-3.5 border-t border-border/60 px-6 pt-2.5 ${clickable}`}
      {...clickProps}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${meta.iconBg}`}
        >
          <RobotMoodIcon severity={severity} className={`h-8 w-8 ${meta.text}`} />
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
        <span className="ml-auto flex items-center gap-2.5">
          {cokingIcon}
          {time && (
            <span className="text-[11px] text-muted-foreground">{time}</span>
          )}
          {onOpenCalendar && (
            <CalendarDays className="h-6 w-6 shrink-0 text-muted-foreground/50 transition-colors group-hover/strip:text-foreground/80" />
          )}
        </span>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={statusText}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="mt-1.5 line-clamp-2 text-center text-xs leading-relaxed text-foreground/75"
        >
          {statusText}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
