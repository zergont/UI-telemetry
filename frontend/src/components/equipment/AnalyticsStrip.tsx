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

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Flame,
  CalendarDays,
  RefreshCwOff,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDuration, formatRelativeTime } from "@/lib/format";
import type {
  ActiveAlarm,
  AnalyticsStaleKind,
  MachineAnalytics,
  SeverityLevel,
} from "@/hooks/use-analytics";

/** Ранг англ. severity тревоги для фильтра «warning и выше». */
const ALARM_RANK: Record<string, number> = {
  SHUTDOWN: 4,
  ALARM: 3,
  WARNING: 3,
  CAUTION: 2,
  INFO: 1,
};

/** Цвет текста тревоги по её собственной severity. */
function alarmSeverityClass(sev: string | null): string {
  if (sev === "SHUTDOWN" || sev === "ALARM") return "text-red-500";
  if (sev === "WARNING") return "text-orange-500";
  return "text-yellow-500";
}
import RobotMoodIcon from "./RobotMoodIcon";

interface SeverityMeta {
  label: string;
  text: string;
  iconBg: string;
  dot: string;
  pulse: boolean;
}

/** 4-уровневая градация (панель важнее аналитики): норма < предупреждение < внимание < авария */
const SEVERITY_META: Record<SeverityLevel, SeverityMeta> = {
  норма: {
    label: "Норма",
    text: "text-emerald-500",
    iconBg: "bg-emerald-500/10",
    dot: "bg-emerald-500",
    pulse: false,
  },
  предупреждение: {
    label: "Предупреждение",
    text: "text-yellow-500",
    iconBg: "bg-yellow-500/10",
    dot: "bg-yellow-400",
    pulse: true,
  },
  внимание: {
    label: "Внимание",
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
    level: "повышенный",
  },
  RED: {
    text: "text-red-500",
    bg: "bg-red-500/10",
    level: "высокий",
  },
} as const;

/** Хвост строки состояния без режима: режим и время уже на плашке под лампами.
 *  «Работа 3ч 12м — параметры в норме.» → «параметры в норме.»; подпись режима
 *  сама может содержать « — » («Работа — ждём подтверждения»), поэтому режем
 *  после неё, а не по первому тире */
function stateTail(text: string, mode: string | null): string {
  const from = mode && text.startsWith(mode) ? mode.length : 0;
  const i = text.indexOf(" — ", from);
  return i >= 0 ? text.slice(i + 3) : text;
}

const PENDING_TEXT = "Наблюдение запущено, ожидание первой сводки…";

interface Props {
  analytics: MachineAnalytics;
  /** Открыть календарь истории аналитики; строка становится кликабельной */
  onOpenCalendar?: () => void;
  /** Однострочный режим для карточки «минимал» */
  compact?: boolean;
  /** Живой статус скрыт (панель offline, data_stale или analytics_stale):
   *  «норма от ИИ» без свежего анализа подрывает доверие, — но строка остаётся
   *  входом в ретроспективу (история/календарь доступны всегда) */
  stale?: boolean;
  /** Почему скрыт: link — «Нет связи — данные на …», analytics — «Аналитика
   *  не обновляется N мин» (панель на связи, cg-analytics v5.1.24) */
  staleKind?: AnalyticsStaleKind;
}

/** «дд.мм, чч:мм» для метки последних данных или последнего анализа */
function staleTs(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** «Аналитика не обновляется 7 мин»; от часа — «… с 17.10, 13:40»: длительность
 *  в сутках читается хуже момента. Лаг считает сервер по своим часам — часы
 *  браузера не участвуют, поэтому число обновляется вместе с /machines (15 с) */
function analyticsStuckText(a: MachineAnalytics): string {
  const lag = a.analytics_lag_sec;
  if (lag == null || lag < 60) return "Аналитика не обновляется";
  if (lag < 3600) return `Аналитика не обновляется ${formatDuration(lag)}`;
  const ts = staleTs(a.analytics_updated_at ?? null);
  return ts
    ? `Аналитика не обновляется с ${ts}`
    : `Аналитика не обновляется ${formatDuration(lag)}`;
}

/** Что с движком — по engine_state; «сторож перезапускает» — только если он
 *  это действительно сделает (engine_auto_restart): выключенный сторож и
 *  машина вне надзора (нужен ПУСК) его не перезапускают */
function engineStateText(a: MachineAnalytics): string {
  const what: Record<string, string> = {
    stalled: "Движок завис",
    zombie: "Прежняя задача движка не завершилась после отмены",
    restart_limit: "Исчерпан лимит перезапусков движка",
    not_started: "Старт движка не удался",
  };
  if (a.engine_state === "needs_start") {
    return "Движок не запущен — нужен ПУСК в cg-analytics.";
  }
  const base = (a.engine_state && what[a.engine_state]) || "Движок завис или не запущен";
  if (a.engine_auto_restart === true) {
    return a.engine_state === "restart_limit"
      ? `${base} — сторож поднимет его позже.`
      : `${base} — сторож перезапускает его.`;
  }
  if (a.engine_auto_restart === false) {
    return `${base} — сторож его не перезапускает.`;
  }
  return `${base}.`;
}

/** Подсказка: чем «не обновляется» отличается от «нет связи», и что сторож */
function analyticsStuckHint(a: MachineAnalytics): string {
  const parts = [
    "Движок аналитики не обработал свежие данные — живой статус скрыт. Связь с панелью есть.",
  ];
  if (a.engine_stalled) {
    parts.push(engineStateText(a));
    if (a.engine_down_reason) {
      parts.push(`Причина: ${a.engine_down_reason.replace(/\.+$/, "")}.`);
    }
  }
  const restarts = a.engine_restarts ?? 0;
  if (restarts > 0) {
    const last = a.last_engine_restart;
    const when = staleTs(last?.ts ?? null);
    const lastText = when
      ? ` (последний ${when}${last?.reason ? ` — ${last.reason}` : ""})`
      : "";
    parts.push(`Перезапусков сторожем: ${restarts}${lastText}.`);
  }
  return parts.join(" ");
}

/** Нижняя строка карточки ДГУ: живая сводка ИИ-аналитики из cg-analytics. */
export default function AnalyticsStrip({
  analytics,
  onOpenCalendar,
  compact = false,
  stale = false,
  staleKind = "link",
}: Props) {
  const severity = analytics.severity_level ?? "норма";
  const meta = SEVERITY_META[severity] ?? SEVERITY_META["норма"];
  const coking =
    analytics.coking_risk === "YELLOW" || analytics.coking_risk === "RED"
      ? COKING_META[analytics.coking_risk]
      : null;
  // Нагар копится в работе, а опасен при следующем пуске: у стоящей машины — «перед пуском»
  const cokingHint =
    coking &&
    (analytics.run_state === 0
      ? `Риск нагара перед пуском: ${coking.level}`
      : `Риск нагара: ${coking.level}`);
  const time = analytics.status_updated
    ? formatRelativeTime(new Date(analytics.status_updated))
    : null;
  // При тревоге — её текст (фолбэк на status_text для старого API); при норме —
  // состояние без режима: «параметры в норме», след гейта, нагар перед пуском.
  // «Ожидание первой сводки» — пока движок ещё ничего не прислал
  const alarmText =
    severity !== "норма"
      ? analytics.alarm_text ?? analytics.status_text
      : analytics.status_text != null
        ? stateTail(analytics.status_text, analytics.mode_label)
        : analytics.mode_label == null
          ? PENDING_TEXT
          : null;
  const alarmClass =
    severity !== "норма" ? meta.text : "text-muted-foreground/70";

  // Активные сигналы панели warning и выше — крутим по одной снизу-вверх, полный
  // список в тултипе. Срабатывания аналитики и снятые гейтом сюда не идут: их
  // вердикт — в строке состояния и пилюле гейта (решение владельца 13.10.2026)
  const activeAlarms: ActiveAlarm[] = (analytics.active_alarms ?? [])
    .filter(
      (a) =>
        a.source === "panel" &&
        !a.gate_suppressed &&
        (ALARM_RANK[a.severity ?? ""] ?? 0) >= 3,
    )
    .sort((a, b) => (ALARM_RANK[b.severity ?? ""] ?? 0) - (ALARM_RANK[a.severity ?? ""] ?? 0));
  const [rotIdx, setRotIdx] = useState(0);
  useEffect(() => {
    if (activeAlarms.length <= 1) return;
    const t = setInterval(
      () => setRotIdx((i) => (i + 1) % activeAlarms.length),
      3500,
    );
    return () => clearInterval(t);
  }, [activeAlarms.length]);
  const rot = activeAlarms.length ? activeAlarms[rotIdx % activeAlarms.length] : null;

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

  // Живой статус скрыт: вместо него — почему («нет связи с …» или «аналитика не
  // обновляется»), вход в историю остаётся.
  // После хуков: rules-of-hooks не позволяют ранний return до useState/useEffect.
  if (stale) {
    const stuck = staleKind === "analytics";
    const StaleIcon = stuck ? RefreshCwOff : WifiOff;
    const ts = staleTs(analytics.last_data_ts);
    const staleText = stuck
      ? analyticsStuckText(analytics)
      : ts
        ? `Нет связи — данные на ${ts}`
        : "Нет связи — данных нет";
    return (
      <div
        className={`group/strip ${compact ? "mt-2.5 pt-2" : "mt-3.5 pt-2.5"} border-t border-border/60 px-6 ${clickable}`}
        {...clickProps}
      >
        <div className="flex items-center gap-2">
          <span
            className={`flex ${compact ? "h-7 w-7" : "h-10 w-10"} shrink-0 items-center justify-center rounded-full bg-muted`}
          >
            <StaleIcon className={`${compact ? "h-4 w-4" : "h-5 w-5"} text-muted-foreground`} />
          </span>
          {!compact && (
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Состояние
            </span>
          )}
          <span
            className="min-w-0 flex-1 truncate text-[11.5px] leading-snug text-muted-foreground"
            title={stuck ? analyticsStuckHint(analytics) : undefined}
          >
            {staleText}
          </span>
          {onOpenCalendar && (
            <CalendarDays
              className={`${compact ? "h-5 w-5" : "h-6 w-6"} shrink-0 text-muted-foreground/50 transition-colors group-hover/strip:text-foreground/80`}
            />
          )}
        </div>
      </div>
    );
  }

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
        <p>{cokingHint}</p>
      </TooltipContent>
    </Tooltip>
  );

  // Пилюля гейта: щит + счётчик обработанных предупреждений за сегмент
  const gateCount = analytics.gate_events_count ?? 0;
  const gateCancelled = analytics.gate_cancelled_count ?? 0;
  const gatePill = (gateCount > 0 || analytics.gate_checked) && (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex shrink-0 cursor-help items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-0.5">
          <ShieldCheck className="h-3 w-3 text-yellow-500" />
          {gateCount > 0 && (
            <span className="text-[10px] font-semibold tabular-nums text-yellow-500">
              {gateCount}
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>
          {gateCount > 0
            ? `Гейт ИИ обработал предупреждений за сегмент: ${gateCount} (отменено: ${gateCancelled}, подтверждено: ${gateCount - gateCancelled})`
            : "Срабатывание аналитики проверено ИИ — угрозы нет"}
        </p>
      </TooltipContent>
    </Tooltip>
  );

  // Строка тревоги. Есть активные ошибки (warning+) — крутим по одной снизу-вверх,
  // при наведении полный список; иначе — одиночный текст статуса (фолбэк).
  const alarmSpan =
    rot ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="relative flex min-w-0 flex-1 items-center overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={rotIdx % activeAlarms.length}
                initial={{ opacity: 0, y: 9 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -9 }}
                transition={{ duration: 0.3 }}
                className={`block truncate text-[11.5px] leading-snug ${alarmSeverityClass(rot.severity)}`}
              >
                {rot.name ?? rot.scenario}
                {activeAlarms.length > 1 && (
                  <span className="ml-1 text-muted-foreground/60">
                    · {(rotIdx % activeAlarms.length) + 1}/{activeAlarms.length}
                  </span>
                )}
              </motion.span>
            </AnimatePresence>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs border border-border bg-popover text-popover-foreground shadow-md [&_svg]:fill-popover">
          <ul className="space-y-1">
            {activeAlarms.map((a, i) => (
              <li key={i} className="flex items-baseline gap-1.5 text-xs">
                <span className={alarmSeverityClass(a.severity)}>●</span>
                <span className="min-w-0">
                  {a.name ?? a.scenario}
                  {a.addr != null && (
                    <span className="text-muted-foreground/70">
                      {" "}
                      ({a.addr}/{a.bit})
                    </span>
                  )}
                  {a.duration_sec > 0 && (
                    <span className="text-muted-foreground/70">
                      {" "}
                      · {formatDuration(a.duration_sec)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    ) : alarmText ? (
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={alarmText}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className={`min-w-0 flex-1 truncate text-[11.5px] leading-snug ${alarmClass}`}
          title={alarmText}
        >
          {alarmText}
        </motion.span>
      </AnimatePresence>
    ) : null;

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
          {gatePill}
          <span className="flex shrink-0 items-center gap-1.5">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot} ${
                meta.pulse ? "animate-pulse" : ""
              }`}
            />
            <span className={`text-[11px] font-medium ${meta.text}`}>
              {meta.label}
            </span>
          </span>
          {alarmSpan ?? <span className="flex-1" />}
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
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Состояние
        </span>
        {gatePill}
        <span className="flex shrink-0 items-center gap-1.5">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot} ${
              meta.pulse ? "animate-pulse" : ""
            }`}
          />
          <span className={`text-[11px] font-medium ${meta.text}`}>
            {meta.label}
          </span>
        </span>
        {alarmSpan ?? <span className="flex-1" />}
        <span className="ml-auto flex shrink-0 items-center gap-2.5">
          {cokingIcon}
          {time && (
            <span className="text-[11px] text-muted-foreground">{time}</span>
          )}
          {onOpenCalendar && (
            <CalendarDays className="h-6 w-6 shrink-0 text-muted-foreground/50 transition-colors group-hover/strip:text-foreground/80" />
          )}
        </span>
      </div>
    </div>
  );
}
