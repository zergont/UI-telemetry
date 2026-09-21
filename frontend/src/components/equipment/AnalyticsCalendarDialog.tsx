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

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Bot,
  ChevronLeft,
  ChevronRight,
  FileWarning,
  ListOrdered,
  Loader2,
  ShieldCheck,
  WifiOff,
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
  type EventSummaryRow,
  type SegmentChronology,
  type SegmentOut,
  type SegmentSeverity,
  type StopIncident,
  type StopIncidentEvent,
  type StandingFault,
  type WarningAnalysis,
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
  FAULT_CLEARED: "Неисправности устранены",
  SHUTDOWN_CLEARED: "Авария снята",
};

/** Сырая тяжесть маски из KB → цвет точки в ленте акта */
const FAULT_SEVERITY_DOT: Record<string, string> = {
  shutdown: "bg-red-500",
  shutdown_cooldown: "bg-red-500",
  derate: "bg-orange-500",
  warning: "bg-orange-500",
};

const CHARACTER_LABELS: Record<string, string> = {
  immediate: "немедленный",
  controlled: "через охлаждение",
  unknown: "не определён",
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
  CAUTION: {
    label: "Предупреждение",
    badge: "bg-yellow-500/15 text-yellow-500 border-yellow-500/20",
    border: "border-l-yellow-400",
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

/** Штриховка «нет связи» — нейтральная к теме (полупрозрачный серый поверх bg) */
const NO_DATA_HATCH: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, transparent 0 6px, rgba(128,128,128,0.14) 6px 12px)",
};

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
  /** Идентификаторы наблюдения — из ответа cg-analytics (/machines), не из
   *  телеметрии дашборда: equip_type может различаться. Примитивами, а не
   *  объектом MachineAnalytics: см. memo ниже. */
  routerSn: string;
  equipType: string;
  panelId: number;
  displayName: string;
  /** Живой обрыв связи (data_stale /machines или панель offline): сегодняшняя
   *  ячейка помечается «нет связи». Примитив — memo не ломает. */
  dataStale?: boolean;
  /** Метка последних данных для подписи «нет связи с …». Вызывающие передают
   *  её ТОЛЬКО при dataStale (иначе null): при живой связи ts обновляется
   *  каждые 15 с и каждый раз обнулял бы memo. */
  lastDataTs?: string | null;
}

/** Диалог — снимок: он не читает телеметрию, только идентификаторы наблюдения.
 *
 *  memo здесь несёт нагрузку: карточка ДГУ ре-рендерится раз в секунду (тик
 *  свежести в useDguPanelValues), а /machines обновляется раз в 15 с и отдаёт
 *  каждый раз новые объекты. Пропсы-примитивы сравниваются по значению, поэтому
 *  ни то, ни другое не доходит до рендера отчёта на сотни КБ.
 *  Условие: вызывающие обязаны держать onOpenChange стабильным (useCallback или
 *  сеттер useState) — инлайновая стрелка обнулит memo без внешних признаков. */
export default memo(function AnalyticsCalendarDialog({
  open,
  onOpenChange,
  routerSn,
  equipType,
  panelId,
  displayName,
  dataStale = false,
  lastDataTs = null,
}: Props) {
  const now = new Date();
  const machine = useMemo(
    () => ({ router_sn: routerSn, equip_type: equipType, panel_id: panelId }),
    [routerSn, equipType, panelId],
  );
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1–12
  const [segId, setSegId] = useState<number | null>(null);

  const { data: segments, isLoading } = useMachineSegments(
    machine,
    year,
    month,
    open,
  );

  // Соседи сегмента по времени — чтобы листать карточки, не возвращаясь
  // в календарь. Порядок хронологический: «назад» = раньше.
  const orderedIds = useMemo(
    () =>
      [...(segments ?? [])]
        .sort((a, b) => (a.t_start ?? "").localeCompare(b.t_start ?? ""))
        .map((s) => s.id),
    [segments],
  );
  const segIdx = segId == null ? -1 : orderedIds.indexOf(segId);
  const prevId = segIdx > 0 ? orderedIds[segIdx - 1] : null;
  const nextId =
    segIdx >= 0 && segIdx < orderedIds.length - 1 ? orderedIds[segIdx + 1] : null;

  // Группировка по операционным суткам движка (op_day, граница 09:00 local);
  // фолбэк — локальная дата t_start. Внутри дня — хронологически (старые сверху)
  const byDay = useMemo(() => {
    const map = new Map<string, SegmentOut[]>();
    for (const seg of segments ?? []) {
      if (!seg.t_start) continue;
      const key = seg.op_day ?? localDateKey(seg.t_start);
      const list = map.get(key) ?? [];
      list.push(seg);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.t_start! < b.t_start! ? -1 : 1));
    }
    return map;
  }, [segments]);

  const lastDayKey = useMemo(() => {
    const keys = [...byDay.keys()].sort();
    return keys.at(-1) ?? null;
  }, [byDay]);

  const lastDayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (lastDayRef.current) {
      lastDayRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [lastDayKey]);

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

  // Живой обрыв: подпись для сегодняшней ячейки («нет связи с дд.мм, чч:мм»)
  const staleLabel = dataStale
    ? `нет связи${
        lastDataTs
          ? ` с ${new Date(lastDataTs).toLocaleString("ru-RU", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}`
          : ""
      }`
    : null;

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
                      // Весь день без связи: все сегменты дня пустые (открытый не в счёт)
                      const allNoData =
                        !!segs?.length && segs.every((s) => s.no_data);

                      return (
                        <div
                          key={key}
                          ref={key === lastDayKey ? lastDayRef : undefined}
                          style={allNoData ? NO_DATA_HATCH : undefined}
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
                          {isToday && staleLabel && (
                            <div className="mb-1 flex items-center gap-1 px-1 text-[10px] leading-tight text-muted-foreground">
                              <WifiOff className="h-3 w-3 shrink-0" />
                              <span className="truncate">{staleLabel}</span>
                            </div>
                          )}
                          {isLoading && !segments ? (
                            <Skeleton className="h-8 w-full rounded-md" />
                          ) : (
                            <div className="space-y-1">
                              {segs?.map((seg) => {
                                // Пустой сегмент (полный обрыв связи): штриховка вместо
                                // заливки по run_state — режим там лишь последний известный
                                const noData = !!seg.no_data;
                                const tint = noData
                                  ? "bg-muted/50 hover:bg-muted/80"
                                  : ((seg.run_state != null
                                      ? RUN_STATE_TINT[seg.run_state]
                                      : undefined) ?? "bg-accent/40 hover:bg-accent");
                                // Отменённое гейтом срабатывание: жёлтый пунктир
                                // вместо сплошной кромки. Но вердикт гейта
                                // касается только аналитики и не может
                                // перебивать сигнал панели — иначе живая
                                // авария рисуется жёлтой «проверено ИИ»
                                const panelLoud =
                                  seg.severity === "SHUTDOWN" ||
                                  seg.severity === "ALARM" ||
                                  seg.severity === "WARNING";
                                const sevBorder = noData
                                  ? "border-l-border"
                                  : seg.gate_checked && !panelLoud
                                    ? "border-dashed border-l-yellow-400"
                                    : SEVERITY_META[severityKey(seg.severity)].border;
                                return (
                                  <button
                                    key={seg.id}
                                    onClick={() => setSegId(seg.id)}
                                    style={noData ? NO_DATA_HATCH : undefined}
                                    className={`block w-full rounded-r-md border-l-4 px-2 py-1.5 text-left transition-colors ${tint} ${sevBorder}`}
                                  >
                                    <span className="flex items-center justify-between gap-1">
                                      <span className="font-mono text-xs leading-tight tabular-nums text-foreground/85">
                                        {timeHM(seg.t_start)}–
                                        {seg.is_open ? "сейчас" : timeHM(seg.t_end)}
                                      </span>
                                      <span className="flex shrink-0 items-center gap-1">
                                        {seg.has_incident && (
                                          <FileWarning className="h-3.5 w-3.5 text-red-500" />
                                        )}
                                        {seg.gate_checked && !panelLoud && (
                                          <ShieldCheck className="h-3.5 w-3.5 text-yellow-500" />
                                        )}
                                        {seg.is_open ? (
                                          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                                        ) : (
                                          seg.has_claude && (
                                            <Bot className="h-3.5 w-3.5 text-primary/70" />
                                          )
                                        )}
                                      </span>
                                    </span>
                                    <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">
                                      {noData ? (
                                        <span className="inline-flex items-center gap-1">
                                          <WifiOff className="h-3 w-3 shrink-0" />
                                          Нет связи
                                        </span>
                                      ) : (
                                        seg.run_state_label ?? "—"
                                      )}
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
                    <span className="h-3 w-1 rounded-sm border border-dashed border-yellow-400" />{" "}
                    проверено ИИ
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-1 rounded-sm bg-orange-500" /> внимание
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-1 rounded-sm bg-red-500" /> авария
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-3 w-3 rounded-sm border border-border bg-muted/50"
                      style={NO_DATA_HATCH}
                    />{" "}
                    нет связи
                  </span>
                  <span className="flex items-center gap-1.5">
                    <FileWarning className="h-3.5 w-3.5 text-red-500" /> акт аварийного останова
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
              <SegmentDetailView
                key="detail"
                segId={segId}
                onBack={() => setSegId(null)}
                onPrev={prevId == null ? undefined : () => setSegId(prevId)}
                onNext={nextId == null ? undefined : () => setSegId(nextId)}
              />
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
});

function SegmentDetailView({
  segId,
  onBack,
  onPrev,
  onNext,
}: {
  segId: number;
  onBack: () => void;
  /** Соседние сегменты по времени; undefined — край месяца */
  onPrev?: () => void;
  onNext?: () => void;
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
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          К календарю
        </button>
        {/* Листание соседних сегментов: смотреть цепочку подряд, не возвращаясь
            каждый раз в календарь. Порядок хронологический */}
        <div className="flex items-center gap-1">
          <button
            onClick={onPrev}
            disabled={!onPrev}
            title="Предыдущий сегмент"
            aria-label="Предыдущий сегмент"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={onNext}
            disabled={!onNext}
            title="Следующий сегмент"
            aria-label="Следующий сегмент"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

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
              {/* Пустой сегмент: «Норма» и режим — лишь последнее известное
                  состояние, вместо них честный бейдж обрыва */}
              {seg.no_data ? (
                <Badge variant="outline" className="text-muted-foreground">
                  <WifiOff className="mr-1 h-3 w-3" />
                  Нет связи весь период
                </Badge>
              ) : (
                <Badge variant="outline" className={meta.badge}>
                  {meta.label}
                </Badge>
              )}
              {seg.gate_checked && (
                <Badge
                  variant="outline"
                  className="border-yellow-500/20 bg-yellow-500/15 text-yellow-600 dark:text-yellow-500"
                >
                  <ShieldCheck className="mr-1 h-3 w-3" />
                  Проверено ИИ — угрозы нет
                </Badge>
              )}
              {!seg.no_data && seg.run_state_label && (
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

          {/* Сводка — детерминированный вердикт, замечания, ключевые показатели */}
          {seg.report_summary_md && (
            <section className="rounded-xl border border-border/60 p-4">
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Сводка
              </h4>
              <MarkdownView>{seg.report_summary_md}</MarkdownView>
            </section>
          )}

          {/* Акт аварийного останова — детерминированная реконструкция
              «Следователя»: что панель записала вокруг останова */}
          {seg.incident_json && (
            <StopIncidentSection
              inc={seg.incident_json}
              analyses={seg.warning_analyses}
              fallbackMd={seg.warning_analysis_md}
            />
          )}

          {/* Продолжение аварии после суточного реза: своего акта у него нет,
              он лежит в голове цепочки */}
          {!seg.incident_json && seg.stop_kind === "EMERGENCY" && seg.continued_from && (
            <p className="rounded-xl border border-red-500/25 bg-red-500/5 p-3 text-[11px] text-muted-foreground">
              <FileWarning className="mr-1 inline h-3.5 w-3.5 text-red-500" />
              Продолжение аварийного останова с прошлых суток — акт в
              предыдущем сегменте, листайте стрелкой влево.
            </p>
          )}

          {/* Хронология стоянки. Показывается и рядом с актом: акт говорит,
              что произошло, лента — что было дальше, пока авария не снята */}
          {seg.chronology_json && (
            <StopChronologySection chrono={seg.chronology_json} />
          )}

          {/* Разборы гейта Claude в моменты срабатываний — не дубль заключения:
              только здесь есть контекст «что предшествовало» (тренд, предыдущий
              сегмент, висевшие тревоги), итоговое заключение его не получает. */}
          {/* У аварийного сегмента разбор переехал внутрь красного блока:
              его заказывает акт, и читать их врозь незачем */}
          {!seg.incident_json && (
            <WarningAnalysesSection
              analyses={seg.warning_analyses}
              fallbackMd={seg.warning_analysis_md}
            />
          )}

          {/* Заключение ИИ */}
          <section className="rounded-xl border border-border/60 bg-accent/30 p-4">
            <h4 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Bot className="h-3.5 w-3.5 text-primary/70" />
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
            ) : seg.no_data ? (
              <p className="text-xs text-muted-foreground">
                Связь отсутствовала весь период — анализ не выполнялся.
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
          {seg.report_md && <ReportSection md={seg.report_md} />}
        </div>
      )}
    </motion.div>
  );
}

/** «12 сут», «3 ч», «40 мин» — сколько маска уже висела к моменту останова */
function ageText(sec: number): string {
  if (sec >= 86400) return `${Math.floor(sec / 86400)} сут`;
  if (sec >= 3600) return `${Math.floor(sec / 3600)} ч`;
  if (sec >= 60) return `${Math.floor(sec / 60)} мин`;
  return `${Math.round(sec)} с`;
}

/** Дата со временем — для событий, отстоящих от останова на дни */
function dateTimeShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Что висело на момент останова: срез состояния, а не лента.
 *  Маска могла подняться задолго до окна — в ленту она не попадёт никогда,
 *  потому что лента фильтрует по началу события. */
function StandingBlock({ items }: { items: StandingFault[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-3">
      <p className="text-[11px] font-medium text-foreground/70">
        Висело на момент останова
      </p>
      <ul className="mt-1 space-y-0.5">
        {items.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px] leading-relaxed">
            <span
              className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${
                FAULT_SEVERITY_DOT[f.severity ?? ""] ?? "bg-muted-foreground/60"
              }`}
            />
            <span className="text-foreground/85">
              {f.name}
              <span className="text-muted-foreground">
                {" "}· с {dateTimeShort(f.since)} ({ageText(f.age_sec)})
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Свод по видам: одна строка на вид за всё окно акта. Число видов ограничено
 *  каталогом регистров и битов, поэтому свод вмещает историю любой длины. */
function SummaryBlock({ rows, total }: { rows: EventSummaryRow[]; total?: number | null }) {
  const [expanded, setExpanded] = useState(false);
  // Свод нужен там, где он что-то сворачивает. На коротком инциденте каждое
  // событие уникально, видов столько же — и свод просто пересказывает ленту
  // другими словами. На длинном цикле он незаменим, здесь только мешает.
  if (!rows.length || (total != null && rows.length >= total)) return null;
  const shown = expanded ? rows : rows.slice(0, 8);
  return (
    <div className="mt-3">
      <p className="text-[11px] font-medium text-foreground/70">
        Что происходило за период
        {total ? (
          <span className="font-normal text-muted-foreground"> · событий {total}</span>
        ) : null}
      </p>
      <ul className="mt-1 space-y-0.5">
        {shown.map((g, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px] leading-relaxed">
            <span
              className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${
                g.kind === "fault"
                  ? (FAULT_SEVERITY_DOT[g.severity ?? ""] ?? "bg-muted-foreground/60")
                  : "bg-sky-500"
              }`}
            />
            <span className="text-foreground/85">
              {g.name}
              <span className="text-muted-foreground">
                {" "}· {g.count > 1 ? `${g.count} раз` : "однократно"}
                {g.count > 1 && g.first && g.last
                  ? `, ${dateTimeShort(g.first)} — ${dateTimeShort(g.last)}`
                  : g.first
                    ? `, ${dateTimeShort(g.first)}`
                    : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {rows.length > shown.length && (
        <button
          onClick={() => setExpanded(true)}
          className="mt-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Показать все виды ({rows.length})
        </button>
      )}
    </div>
  );
}

/** Время события ленты — с секундами: авария разворачивается за секунды */
function timeHMS(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Строка события: «Режим двигателя: Работа» или имя неисправности */
function incidentEventText(e: StopIncidentEvent): string {
  if (e.kind === "fault") return e.name ?? "Неисправность";
  const what = e.name ?? (e.addr != null ? `Регистр ${e.addr}` : "Состояние");
  const value = e.label ?? (e.value != null ? String(e.value) : null);
  return value ? `${what}: ${value}` : what;
}

/** Сколько событий ленты показываем до нажатия «показать все» */
const INCIDENT_HEAD = 30;

/** Акт аварийного останова: вердикт характера и лента событий вокруг останова.
 *  Строится детерминированно («Следователь»), без ИИ — поэтому стоит выше
 *  заключения: это факты панели, а не их интерпретация. */
function StopIncidentSection({
  inc,
  analyses,
  fallbackMd,
}: {
  inc: StopIncident;
  /** Разбор от ИИ: у аварии его заказывает сам акт, поэтому он живёт здесь,
   *  а не в отдельном жёлтом блоке */
  analyses?: WarningAnalysis[] | null;
  fallbackMd?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ch = inc.character;
  const votes = [...(ch?.immediate_votes ?? []), ...(ch?.controlled_votes ?? [])];
  const events = inc.chronology ?? [];
  const standing = inc.standing ?? [];
  const summary = inc.summary ?? [];

  const items = (analyses ?? []).filter((a) => a?.md);
  const texts = items.length
    ? items.map((a) => a.md as string)
    : fallbackMd
      ? [fallbackMd]
      : [];

  return (
    <section className="rounded-xl border border-red-500/25 bg-red-500/5 p-4">
      <h4 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-red-500">
        <FileWarning className="h-3.5 w-3.5" />
        Акт аварийного останова
      </h4>

      <p className="text-xs text-foreground/80">
        Останов в {timeHMS(inc.stop_ts)}
        {ch?.character && (
          <> · характер: {CHARACTER_LABELS[ch.character] ?? ch.character}</>
        )}
        {ch?.confidence === "low" && (
          <span className="text-muted-foreground"> (сигналы расходятся)</span>
        )}
      </p>
      {votes.length > 0 && (
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {votes.join(" · ")}
        </p>
      )}
      {inc.window?.baseline === "fallback" && (
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Предшествующего штатного останова в истории не нашлось — окно взято
          по последним сегментам.
        </p>
      )}

      {/* Разбор от ИИ — главное в блоке, поэтому сразу после шапки и
          развёрнутым. Заказывает его сам акт, см. online/incident_gate.py */}
      {texts.length > 0 && (
        <div className="mt-3 border-t border-red-500/15 pt-3">
          <p className="mb-1 text-[11px] font-medium text-foreground/70">
            Анализ аварийного останова
          </p>
          {texts.map((md, i) => (
            <MarkdownView key={i}>{md}</MarkdownView>
          ))}
        </div>
      )}

      {/* Факты под спойлером: они обосновывают анализ, но читают их реже */}
      {(standing.length > 0 || summary.length > 0 || events.length > 0) && (
        <div className="mt-3 border-t border-red-500/15 pt-2">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
            />
            Хронология: что висело и как это произошло
          </button>
          {open && (
            <>
              <StandingBlock items={standing} />
              <SummaryBlock rows={summary} total={inc.events_total} />
              {events.length > 0 && (
                <p className="mt-3 text-[11px] font-medium text-foreground/70">
                  Как это произошло
                </p>
              )}
              <ChronologyList events={events} />
            </>
          )}
        </div>
      )}
    </section>
  );
}


/** Лента событий панели: время с секундами, точка по типу и тяжести, подпись.
 *  Общая для акта аварийного останова и для хронологии стоянки. */
function ChronologyList({ events }: { events: StopIncidentEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!events.length) return null;
  const shown = expanded ? events : events.slice(0, INCIDENT_HEAD);

  return (
    <>
      <ol className="mt-3 space-y-1">
        {shown.map((e, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px] leading-relaxed">
            <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
              {timeHMS(e.ts)}
            </span>
            <span
              className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${
                e.kind === "fault"
                  ? (FAULT_SEVERITY_DOT[e.severity ?? ""] ?? "bg-muted-foreground/60")
                  : "bg-sky-500"
              }`}
            />
            <span className="text-foreground/85">
              {incidentEventText(e)}
              {e.kind === "fault" && e.end && (
                <span className="text-muted-foreground"> · снято в {timeHMS(e.end)}</span>
              )}
            </span>
          </li>
        ))}
      </ol>
      {events.length > shown.length && (
        <button
          onClick={() => setExpanded(true)}
          className="mt-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Показать все события ({events.length})
        </button>
      )}
    </>
  );
}

/** Хронология стоянки — что панель записала, пока машина стояла. Без вердикта:
 *  разбирать тут нечего, важна сама последовательность. Показывается только
 *  там, где акта нет — у аварийного стопа лента живёт внутри акта. */
function StopChronologySection({ chrono }: { chrono: SegmentChronology }) {
  const events = chrono.chronology ?? [];
  if (!events.length) return null;

  return (
    <section className="rounded-xl border border-border/60 p-4">
      <h4 className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <ListOrdered className="h-3.5 w-3.5" />
        Хронология стоянки
      </h4>
      <p className="text-[11px] text-muted-foreground">
        Что панель записала за этот период — сообщения, сбросы, смены команд.
        Для аварийного стопа это продолжение: как неисправности снимались одна
        за другой.
      </p>
      <ChronologyList events={events} />
    </section>
  );
}

/** Заголовок разбора: «16.07, 09:03 — Низкое давление масла…» */
function analysisHeading(wa: WarningAnalysis, idx: number): string {
  const time =
    wa.t &&
    new Date(wa.t).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  return [time, wa.alarm_text].filter(Boolean).join(" — ") || `Событие ${idx + 1}`;
}

/** Разборы гейта в моменты срабатываний — свёрнутый список, молодые сверху.
 *
 *  История (cg-analytics v4.9.36+): смена состава тревог не затирает разбор
 *  исходной аварии, так что событий бывает несколько. При закрытии сегмента
 *  сортировка — от свежего к старому; каждое событие раскрывается по клику,
 *  по умолчанию все свёрнуты (перечень заголовков). Свёрнутый разбор не
 *  монтирует MarkdownView вовсе — рендер откладывается до раскрытия.
 *  Фолбэк warning_analysis_md (сегменты до v4.9.36) — один разбор без метки
 *  времени, показываем как есть, сворачивать нечего. */
function WarningAnalysesSection({
  analyses,
  fallbackMd,
}: {
  analyses: WarningAnalysis[] | null;
  fallbackMd: string | null;
}) {
  // Молодые сверху; копия — не мутируем массив из кэша react-query
  const ordered = useMemo(
    () => (analyses?.length ? [...analyses].reverse() : null),
    [analyses],
  );
  const [open, setOpen] = useState<Set<number>>(() => new Set());

  if (!ordered && !fallbackMd) return null;

  function toggle(i: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <section className="rounded-xl border border-border/60 p-4">
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-yellow-600 dark:text-yellow-500">
        {(ordered?.length ?? 0) > 1 ? "Разборы в моменты событий" : "Разбор в момент события"}
      </h4>
      <p className="mb-1 text-[11px] italic text-muted-foreground">
        сформирован ИИ онлайн, при срабатывании — до закрытия сегмента
      </p>

      {ordered ? (
        <div className="-mx-1">
          {ordered.map((wa, i) => {
            const isOpen = open.has(i);
            return (
              <div key={i} className={i > 0 ? "border-t border-border/60" : undefined}>
                <button
                  onClick={() => toggle(i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-2 px-1 py-2.5 text-left transition-colors hover:text-foreground"
                >
                  <ChevronRight
                    className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
                      isOpen ? "rotate-90" : ""
                    }`}
                  />
                  <span className="text-xs font-semibold text-foreground/85">
                    {analysisHeading(wa, i)}
                  </span>
                </button>
                {isOpen && wa.md && (
                  <div className="px-1 pb-3 pl-6">
                    <MarkdownView>{wa.md}</MarkdownView>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-1">
          <MarkdownView>{fallbackMd!}</MarkdownView>
        </div>
      )}
    </section>
  );
}

/** Полный отчёт аналитики — только по запросу: это сотни КБ маркдауна
 *  (десятки тысяч DOM-узлов), синхронный рендер вешает вкладку при открытии карточки. */
function ReportSection({ md }: { md: string }) {
  const [show, setShow] = useState(false);

  return (
    <section className="rounded-xl border border-border/60 p-4">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Отчёт аналитики
      </h4>
      {show ? (
        <MarkdownView>{md}</MarkdownView>
      ) : (
        <button
          onClick={() => setShow(true)}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className="h-3.5 w-3.5" />
          Показать полный отчёт ({Math.max(1, Math.round(md.length / 1024))} КБ)
        </button>
      )}
    </section>
  );
}
