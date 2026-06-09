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

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useMachineSegments,
  useSegmentDetail,
  type MachineAnalytics,
  type SegmentOut,
  type SegmentSeverity,
} from "@/hooks/use-analytics";
import { formatDuration } from "@/lib/format";
import MarkdownView from "./MarkdownView";

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const CAUSE_LABELS: Record<string, string> = {
  RUN_STATE_CHANGE: "Смена режима",
  DAILY_BOUNDARY: "Суточная граница",
  OPERATOR_STOP: "Остановка оператором",
};

/** Ранг severity для выбора максимума за день */
const SEVERITY_RANK: Record<string, number> = {
  SHUTDOWN: 4,
  ALARM: 3,
  WARNING: 2,
  INFO: 1,
};

const SEVERITY_META: Record<
  string,
  { label: string; day: string; badge: string }
> = {
  SHUTDOWN: {
    label: "Авар. останов",
    day: "bg-red-500/15 text-red-500 hover:bg-red-500/25",
    badge: "bg-red-500/15 text-red-500 border-red-500/20",
  },
  ALARM: {
    label: "Тревога",
    day: "bg-red-500/15 text-red-500 hover:bg-red-500/25",
    badge: "bg-red-500/15 text-red-500 border-red-500/20",
  },
  WARNING: {
    label: "Внимание",
    day: "bg-amber-500/15 text-amber-500 hover:bg-amber-500/25",
    badge: "bg-amber-500/15 text-amber-500 border-amber-500/20",
  },
  NORM: {
    label: "Норма",
    day: "bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25",
    badge: "bg-emerald-500/15 text-emerald-500 border-emerald-500/20",
  },
};

function severityKey(sev: SegmentSeverity): string {
  return sev === "SHUTDOWN" || sev === "ALARM" || sev === "WARNING"
    ? sev
    : "NORM";
}

/** Локальная дата yyyy-mm-dd из ISO-метки (UTC) */
function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function timeHM(iso: string | null): string {
  if (!iso) return "…";
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machine: MachineAnalytics;
  displayName: string;
}

export default function AnalyticsCalendarDialog({
  open,
  onOpenChange,
  machine,
  displayName,
}: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1–12
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [segId, setSegId] = useState<number | null>(null);

  const { data: segments, isLoading } = useMachineSegments(
    machine,
    year,
    month,
    open,
  );

  // Группировка сегментов по локальной дате t_start
  const byDay = useMemo(() => {
    const map = new Map<string, SegmentOut[]>();
    for (const seg of segments ?? []) {
      if (!seg.t_start) continue;
      const key = localDateKey(seg.t_start);
      const list = map.get(key) ?? [];
      list.push(seg);
      map.set(key, list);
    }
    return map;
  }, [segments]);

  // Без явного выбора показываем самый свежий день с сегментами
  const latestDay = useMemo(() => {
    const first = segments?.find((s) => s.t_start);
    return first ? localDateKey(first.t_start!) : null;
  }, [segments]);
  const effectiveDay = selectedDay ?? latestDay;

  function shiftMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m);
    setYear(y);
    setSelectedDay(null);
  }

  // Сетка месяца: смещение первого дня (Пн = 0) + число дней
  const firstOffset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayKey = localDateKey(new Date().toISOString());
  const isCurrentMonth =
    year === now.getFullYear() && month === now.getMonth() + 1;

  const daySegments = effectiveDay ? byDay.get(effectiveDay) ?? [] : [];

  function handleClose(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setSegId(null);
      setSelectedDay(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            </span>
            {segId == null ? "История аналитики" : "Анализ сегмента"}
          </DialogTitle>
          <DialogDescription>
            {displayName} · {machine.router_sn}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <AnimatePresence mode="wait" initial={false}>
            {segId == null ? (
              <motion.div
                key="calendar"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.18 }}
              >
                {/* Навигация по месяцам */}
                <div className="mb-3 flex items-center justify-between">
                  <button
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() => shiftMonth(-1)}
                    aria-label="Предыдущий месяц"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-sm font-semibold">
                    {MONTHS[month - 1]} {year}
                  </span>
                  <button
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
                    onClick={() => shiftMonth(1)}
                    disabled={isCurrentMonth}
                    aria-label="Следующий месяц"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                {/* Календарная сетка */}
                <div className="grid grid-cols-7 gap-1.5 text-center">
                  {WEEKDAYS.map((wd) => (
                    <div
                      key={wd}
                      className="pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      {wd}
                    </div>
                  ))}
                  {Array.from({ length: firstOffset }).map((_, i) => (
                    <div key={`pad-${i}`} />
                  ))}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const segs = byDay.get(key);
                    const maxSev = segs?.reduce(
                      (acc, s) =>
                        (SEVERITY_RANK[s.severity ?? ""] ?? 1) >
                        (SEVERITY_RANK[acc ?? ""] ?? 1)
                          ? s.severity
                          : acc,
                      null as SegmentSeverity,
                    );
                    const meta = segs
                      ? SEVERITY_META[severityKey(maxSev ?? null)]
                      : null;
                    const hasClaude = segs?.some((s) => s.has_claude);
                    const isToday = key === todayKey;
                    const isSelected = key === effectiveDay;

                    return (
                      <button
                        key={key}
                        disabled={!segs}
                        onClick={() => setSelectedDay(key)}
                        className={`relative flex aspect-square flex-col items-center justify-center rounded-lg text-xs font-medium transition-all ${
                          meta
                            ? `cursor-pointer ${meta.day}`
                            : "text-muted-foreground/40"
                        } ${isSelected ? "ring-2 ring-ring" : ""} ${
                          isToday && !meta ? "text-foreground" : ""
                        }`}
                      >
                        {isLoading && !segments ? (
                          <Skeleton className="h-4 w-4 rounded" />
                        ) : (
                          <>
                            <span className={isToday ? "underline underline-offset-2" : ""}>
                              {day}
                            </span>
                            {hasClaude && (
                              <Sparkles className="absolute right-1 top-1 h-2.5 w-2.5 opacity-80" />
                            )}
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Легенда */}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> норма
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-amber-400" /> внимание
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-red-500" /> тревога
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3" /> есть заключение ИИ
                  </span>
                </div>

                {/* Сегменты выбранного дня */}
                <div className="mt-4 border-t border-border/60 pt-3">
                  {!effectiveDay || daySegments.length === 0 ? (
                    <p className="py-4 text-center text-xs text-muted-foreground">
                      {segments?.length
                        ? "Выберите день с записями"
                        : isLoading
                          ? "Загрузка…"
                          : "В этом месяце записей нет"}
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {daySegments.map((seg) => {
                        const meta = SEVERITY_META[severityKey(seg.severity)];
                        return (
                          <button
                            key={seg.id}
                            onClick={() => setSegId(seg.id)}
                            className="flex w-full items-center gap-3 rounded-lg border border-border/60 px-3 py-2 text-left transition-colors hover:border-border hover:bg-accent/50"
                          >
                            <span className="font-mono text-xs tabular-nums text-foreground/80">
                              {timeHM(seg.t_start)}–{seg.is_open ? "сейчас" : timeHM(seg.t_end)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {seg.run_state_label ?? "—"}
                              {seg.duration_sec != null &&
                                ` · ${formatDuration(seg.duration_sec)}`}
                            </span>
                            <span className="ml-auto flex items-center gap-1.5">
                              {seg.has_claude && (
                                <Sparkles className="h-3 w-3 text-primary/70" />
                              )}
                              {seg.is_open && (
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                              )}
                              <Badge variant="outline" className={`${meta.badge} text-[10px]`}>
                                {meta.label}
                              </Badge>
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              <SegmentDetailView key="detail" segId={segId} onBack={() => setSegId(null)} />
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SegmentDetailView({
  segId,
  onBack,
}: {
  segId: number;
  onBack: () => void;
}) {
  const { data: seg, isLoading, isError } = useSegmentDetail(segId);
  const meta = SEVERITY_META[severityKey(seg?.severity ?? null)];
  const analysisStatus = seg?.analysis?.status;

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ duration: 0.18 }}
    >
      <button
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        К календарю
      </button>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {isError && (
        <p className="py-6 text-center text-xs text-muted-foreground">
          Не удалось загрузить сегмент — cg-analytics недоступен.
        </p>
      )}

      {seg && (
        <div className="space-y-4">
          {/* Шапка сегмента */}
          <div>
            <p className="text-sm font-semibold">
              {seg.t_start &&
                new Date(seg.t_start).toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              {", "}
              {timeHM(seg.t_start)}–{seg.is_open ? "сейчас" : timeHM(seg.t_end)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className={meta.badge}>
                {meta.label}
              </Badge>
              {seg.run_state_label && (
                <Badge variant="outline" className="text-muted-foreground">
                  {seg.run_state_label}
                </Badge>
              )}
              {seg.duration_sec != null && (
                <Badge variant="outline" className="text-muted-foreground">
                  {formatDuration(seg.duration_sec)}
                </Badge>
              )}
              {seg.cause_close && (
                <Badge variant="outline" className="text-muted-foreground">
                  {CAUSE_LABELS[seg.cause_close] ?? seg.cause_close}
                </Badge>
              )}
              {seg.is_open && (
                <Badge variant="outline" className="border-blue-500/20 bg-blue-500/15 text-blue-400">
                  <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                  Идёт сейчас
                </Badge>
              )}
            </div>
            {seg.is_open && seg.status_text && (
              <p className="mt-2 text-xs leading-relaxed text-foreground/75">
                {seg.status_text}
              </p>
            )}
          </div>

          {/* Заключение ИИ */}
          <section className="rounded-xl border border-border/60 bg-accent/30 p-4">
            <h4 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary/70" />
              Заключение ИИ
            </h4>
            {seg.analysis?.conclusion_md ? (
              <MarkdownView>{seg.analysis.conclusion_md}</MarkdownView>
            ) : analysisStatus === "pending" || analysisStatus === "processing" ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Заключение готовится…
              </p>
            ) : analysisStatus === "error" ? (
              <p className="text-xs text-muted-foreground">
                Анализ завершился с ошибкой.
              </p>
            ) : seg.is_open ? (
              <p className="text-xs text-muted-foreground">
                Заключение формируется после закрытия сегмента.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Анализ для этого сегмента не запускался.
              </p>
            )}
          </section>

          {/* Отчёт аналитики */}
          {seg.report_md && (
            <section className="rounded-xl border border-border/60 p-4">
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Отчёт аналитики
              </h4>
              <MarkdownView>{seg.report_md}</MarkdownView>
            </section>
          )}
        </div>
      )}
    </motion.div>
  );
}
