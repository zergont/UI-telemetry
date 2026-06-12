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
  Bot,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
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

/** Severity сегмента → 4-ступенчатая градация: авария / внимание (панель) / предупреждение (аналитика) / норма */
const SEVERITY_META: Record<string, { label: string; badge: string; border: string }> = {
  SHUTDOWN: {
    label: "Авар. останов",
    badge: "bg-red-500/15 text-red-500 border-red-500/20",
    border: "border-l-red-500",
  },
  ALARM: {
    label: "Авария",
    badge: "bg-red-500/15 text-red-500 border-red-500/20",
    border: "border-l-red-500",
  },
  WARNING: {
    label: "Внимание",
    badge: "bg-orange-500/15 text-orange-500 border-orange-500/20",
    border: "border-l-orange-500",
  },
  INFO: {
    label: "Предупреждение",
    badge: "bg-yellow-500/15 text-yellow-500 border-yellow-500/20",
    border: "border-l-yellow-400",
  },
  NORM: {
    label: "Норма",
    badge: "bg-emerald-500/15 text-emerald-500 border-emerald-500/20",
    border: "border-l-emerald-500",
  },
};

/** Заливка плашки по режиму работы (run_state); состояние подписано на самой плашке */
const RUN_STATE_TINT: Record<number, string> = {
  0: "bg-slate-500/10 hover:bg-slate-500/20",      // Стоп
  1: "bg-yellow-500/10 hover:bg-yellow-500/20",    // Задержка пуска
  2: "bg-yellow-500/10 hover:bg-yellow-500/20",    // Прогрев
  3: "bg-green-500/10 hover:bg-green-500/20",      // Работа
  4: "bg-orange-500/10 hover:bg-orange-500/20",    // Разгрузка
  5: "bg-sky-500/10 hover:bg-sky-500/20",          // Охлаждение на х.х.
  6: "bg-sky-500/10 hover:bg-sky-500/20",          // Переход на х.х.
};

function severityKey(sev: SegmentSeverity): string {
  return sev != null && sev in SEVERITY_META ? sev : "NORM";
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
  const [segId, setSegId] = useState<number | null>(null);

  const { data: segments, isLoading } = useMachineSegments(
    machine,
    year,
    month,
    open,
  );

  // Группировка по локальной дате t_start; внутри дня — хронологически (старые сверху)
  const byDay = useMemo(() => {
    const map = new Map<string, SegmentOut[]>();
    for (const seg of segments ?? []) {
      if (!seg.t_start) continue;
      const key = localDateKey(seg.t_start);
      const list = map.get(key) ?? [];
      list.push(seg);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.t_start! < b.t_start! ? -1 : 1));
    }
    return map;
  }, [segments]);

  function shiftMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m);
    setYear(y);
  }

  // Сетка месяца: смещение первого дня (Пн = 0) + число дней
  const firstOffset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayKey = localDateKey(new Date().toISOString());
  const isCurrentMonth =
    year === now.getFullYear() && month === now.getMonth() + 1;

  function handleClose(next: boolean) {
    onOpenChange(next);
    if (!next) setSegId(null);
  }

  // Крестик и Escape из анализа возвращают в календарь, а не закрывают диалог
  function handleDismiss() {
    if (segId != null) setSegId(null);
    else handleClose(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-[85vw]"
        showCloseButton={false}
        onClick={(e) => e.stopPropagation()}
        onEscapeKeyDown={(e) => {
          if (segId != null) {
            e.preventDefault();
            setSegId(null);
          }
        }}
        onInteractOutside={(e) => {
          if (segId != null) {
            e.preventDefault();
            setSegId(null);
          }
        }}
      >
        <button
          onClick={handleDismiss}
          aria-label={segId != null ? "Назад к календарю" : "Закрыть"}
          className="absolute top-4 right-4 z-10 rounded-xs opacity-70 transition-opacity hover:opacity-100"
        >
          <X className="size-4" />
        </button>

        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
              <Bot className="h-4 w-4 text-primary" />
            </span>
            {segId == null ? "История аналитики" : "Анализ сегмента"}
          </DialogTitle>
          <DialogDescription>
            {displayName} · {machine.router_sn}
          </DialogDescription>
        </DialogHeader>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-2">
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
                <div className="mb-3 flex items-center justify-center gap-4">
                  <button
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() => shiftMonth(-1)}
                    aria-label="Предыдущий месяц"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="min-w-36 text-center text-sm font-semibold">
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

                {/* Календарная сетка с сегментами в ячейках */}
                <div className="overflow-x-auto">
                  <div className="grid min-w-[640px] grid-cols-7 gap-1.5">
                    {WEEKDAYS.map((wd) => (
                      <div
                        key={wd}
                        className="pb-1 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
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
                      const isToday = key === todayKey;

                      return (
                        <div
                          key={key}
                          className={`min-h-20 rounded-lg border p-1.5 ${
                            isToday
                              ? "border-border/70 bg-muted/70"
                              : segs
                                ? "border-border/60 bg-muted/50"
                                : "border-border/30 bg-muted/25"
                          }`}
                        >
                          <div
                            className={`px-1 pb-1.5 text-[11px] font-medium tabular-nums ${
                              isToday
                                ? "text-foreground"
                                : segs
                                  ? "text-muted-foreground"
                                  : "text-muted-foreground/50"
                            }`}
                          >
                            {day}
                          </div>
                          {isLoading && !segments ? (
                            <Skeleton className="h-8 w-full rounded-md" />
                          ) : (
                            <div className="space-y-1">
                              {segs?.map((seg) => {
                                const tint =
                                  (seg.run_state != null
                                    ? RUN_STATE_TINT[seg.run_state]
                                    : undefined) ?? "bg-accent/40 hover:bg-accent";
                                const sevBorder =
                                  SEVERITY_META[severityKey(seg.severity)].border;
                                return (
                                  <button
                                    key={seg.id}
                                    onClick={() => setSegId(seg.id)}
                                    className={`block w-full rounded-r-md border-l-4 px-2 py-1.5 text-left transition-colors ${tint} ${sevBorder}`}
                                  >
                                    <span className="flex items-center justify-between gap-1">
                                      <span className="font-mono text-xs leading-tight tabular-nums text-foreground/85">
                                        {timeHM(seg.t_start)}–
                                        {seg.is_open ? "сейчас" : timeHM(seg.t_end)}
                                      </span>
                                      {seg.is_open ? (
                                        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-blue-500" />
                                      ) : (
                                        seg.has_claude && (
                                          <Bot className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                                        )
                                      )}
                                    </span>
                                    <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">
                                      {seg.run_state_label ?? "—"}
                                      {seg.duration_sec != null &&
                                        ` · ${formatDuration(seg.duration_sec)}`}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Легенда */}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-1 rounded-sm bg-emerald-500" /> норма
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-1 rounded-sm bg-yellow-400" /> предупреждение
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-1 rounded-sm bg-orange-500" /> внимание
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-1 rounded-sm bg-red-500" /> авария
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Bot className="h-3.5 w-3.5" /> есть заключение ИИ
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" /> идёт сейчас
                  </span>
                  {!isLoading && !segments?.length && (
                    <span className="ml-auto">В этом месяце записей нет</span>
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
              <Bot className="h-3.5 w-3.5 text-primary/70" />
              Заключение ИИ
            </h4>
            {/* Онлайн-анализ предупреждения (гейт Claude) — доступен до закрытия сегмента */}
            {seg.warning_analysis_md && (
              <div className="mb-3 border-b border-border/60 pb-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-yellow-600 dark:text-yellow-500">
                  Онлайн-анализ предупреждения
                </p>
                <MarkdownView>{seg.warning_analysis_md}</MarkdownView>
              </div>
            )}
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
                Финальный отчёт будет сформирован после закрытия сегмента.
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
