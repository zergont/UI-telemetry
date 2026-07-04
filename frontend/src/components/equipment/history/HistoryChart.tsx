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

import { useEffect, useLayoutEffect, useRef, useCallback } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { MIN_SPAN_MS } from "./constants";
import type { ChartPoint, ViewportRange } from "./types";
import type { GapMs } from "@/hooks/use-chart-engine";

/* ── Props ──────────────────────────────────────────────────────────────── */

/** Серия графика: метаданные + точки */
export interface ChartSeriesInput {
  label: string;
  unit: string;
  color: string;
  points: ChartPoint[];
}

interface HistoryChartProps {
  /** Одна серия — режим area+band+маркеры; несколько — линии (фазы, масло P+t) */
  series: ChartSeriesInput[];
  gaps: GapMs[];
  viewport: ViewportRange;
  isLoading: boolean;
  tzOffsetHours: number;
  onZoom: (cursorTimeMs: number, zoomIn: boolean) => void;
  onPan: (vp: ViewportRange) => void;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const DAY_SEC = 86_400;

/* ── Автовысота: график заполняет остаток окна, страница без прокрутки ── */

const CHART_MIN_H = 260;
/** Резерв под низ страницы: нижний отступ main (24px) + футер (~41px) + запас */
const CHART_BOTTOM_GAP = 68;

/** Высота графика от текущей позиции контейнера до низа окна */
function fitChartHeight(el: HTMLElement): number {
  // Абсолютная позиция (с учётом scrollY) — расчёт не зависит от прокрутки
  const top = el.getBoundingClientRect().top + window.scrollY;
  return Math.max(CHART_MIN_H, Math.floor(window.innerHeight - top - CHART_BOTTOM_GAP));
}

/** Подготовка одной серии: ChartPoint[] → [times, values, mins, maxs] */
function toUPlotData(
  pts: ChartPoint[],
  tzOffSec: number,
): [number[], number[], number[], number[]] {
  const len = pts.length;
  const times = new Array<number>(len);
  const values = new Array<number>(len);
  const mins = new Array<number>(len);
  const maxs = new Array<number>(len);

  for (let i = 0; i < len; i++) {
    const p = pts[i];
    times[i] = p.ts / 1000 + tzOffSec;
    values[i] = p.value!;
    const hasAgg = p.sampleCount != null && p.sampleCount > 1;
    mins[i] = hasAgg && p.minValue != null ? p.minValue : p.value!;
    maxs[i] = hasAgg && p.maxValue != null ? p.maxValue : p.value!;
  }

  return [times, values, mins, maxs];
}

/** Мультисерийные данные: join таблиц [x, y] по общей оси времени */
function toUPlotDataMulti(
  seriesPts: ChartPoint[][],
  tzOffSec: number,
): uPlot.AlignedData {
  const tables: uPlot.AlignedData[] = seriesPts.map((pts) => {
    const xs = new Array<number>(pts.length);
    const ys = new Array<number>(pts.length);
    for (let i = 0; i < pts.length; i++) {
      xs[i] = pts[i].ts / 1000 + tzOffSec;
      ys[i] = pts[i].value!;
    }
    return [xs, ys] as uPlot.AlignedData;
  });
  return uPlot.join(tables);
}

/** Подпись значения по величине */
function formatVal(v: number | null | undefined): string {
  if (v == null) return "—";
  return v >= 10000 ? (v / 1000).toFixed(2) + "k" : Math.round(v).toString();
}

interface SeriesMeta {
  label: string;
  unit: string;
  color: string;
}

/* ── Component ──────────────────────────────────────────────────────────── */

export function HistoryChart({
  series,
  gaps,
  viewport,
  isLoading,
  tzOffsetHours,
  onZoom,
  onPan,
}: HistoryChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const prevPointsRef = useRef<ChartPoint[][] | null>(null);
  const appliedVpRef = useRef<ViewportRange>(viewport);
  const viewportPropRef = useRef(viewport);
  viewportPropRef.current = viewport;

  const onZoomRef = useRef(onZoom);
  const onPanRef = useRef(onPan);
  onZoomRef.current = onZoom;
  onPanRef.current = onPan;

  const metaRef = useRef<SeriesMeta[]>(series);
  metaRef.current = series.map(({ label, unit, color }) => ({ label, unit, color }));
  const colorRef = useRef(series[0]?.color ?? "#22c55e");
  colorRef.current = series[0]?.color ?? "#22c55e";
  const singleRef = useRef(series.length <= 1);
  singleRef.current = series.length <= 1;

  const tzOffRef = useRef(tzOffsetHours * 3600);
  tzOffRef.current = tzOffsetHours * 3600;

  const gapsRef = useRef<GapMs[]>(gaps);
  gapsRef.current = gaps;

  // Таймер debounce пана
  const panTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Подавление событий scale change (наш zoom, не пользовательский pan)
  const suppressRef = useRef(false);
  // Drag состояние
  const isDraggingRef = useRef(false);
  const pendingDataRef = useRef<ChartPoint[][] | null>(null);

  // Сигнатура конфигурации: смена состава серий пересоздаёт график
  const seriesSig = series
    .map((s) => `${s.label}|${s.unit}|${s.color}`)
    .join(";");

  /* ── Применение данных к графику ─────────────────────────────────────── */
  const applyDataToChart = useCallback(
    (ptsArr: ChartPoint[][]) => {
      const u = chartRef.current;
      if (!u) return;

      prevPointsRef.current = ptsArr;

      const uData = singleRef.current
        ? toUPlotData(ptsArr[0] ?? [], tzOffRef.current)
        : toUPlotDataMulti(ptsArr, tzOffRef.current);

      // suppressRef предотвращает лишние pan-события при пересчёте масштабов
      suppressRef.current = true;
      // true → пересчитать ВСЕ оси (включая Y). Без этого Y остаётся 0–1.
      u.setData(uData as uPlot.AlignedData, true);
      // Затем переопределяем X нашим viewport (Y остаётся авто)
      const vp = appliedVpRef.current;
      u.setScale("x", {
        min: vp.from / 1000 + tzOffRef.current,
        max: vp.to / 1000 + tzOffRef.current,
      });
      requestAnimationFrame(() => {
        suppressRef.current = false;
      });
    },
    [],
  );

  /* ── Подгонка высоты: страница помещается в окно без прокрутки ───────── */
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const refit = () => {
      const h = fitChartHeight(el);
      // Порог 1px против петли: смена высоты графика меняет высоту body
      if (Math.abs(h - el.clientHeight) > 1) el.style.height = `${h}px`;
    };
    refit();

    // Сдвиги контента над графиком (подгрузка блока аналитики и т.п.)
    // меняют высоту body — пересчитываем позицию
    const ro = new ResizeObserver(refit);
    ro.observe(document.body);
    window.addEventListener("resize", refit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", refit);
    };
  }, []);

  /* ── Создание графика (пересоздаётся при смене состава серий) ─────────── */
  useEffect(() => {
    if (!containerRef.current) return;

    const el = containerRef.current;
    const W = el.clientWidth;
    const H = el.clientHeight || CHART_MIN_H;
    const single = series.length <= 1;
    // Единицы → шкалы: первая единица — правая ось "y", вторая — левая "y2"
    const primaryUnit = series[0]?.unit ?? "";
    const hasSecondScale =
      !single && series.some((s) => s.unit !== primaryUnit);
    const scaleFor = (unit: string) =>
      unit === primaryUnit ? "y" : "y2";

    // Gradient fill для area (только одиночный режим)
    function areaFill(u: uPlot, seriesIdx: number) {
      const ctx = u.ctx;
      const s = u.series[seriesIdx];
      const sc = u.scales[s.scale!];
      if (sc.min == null || sc.max == null) return "transparent";

      const y0 = u.valToPos(sc.min, s.scale!, true);
      const y1 = u.valToPos(sc.max, s.scale!, true);
      const grad = ctx.createLinearGradient(0, y1, 0, y0);
      grad.addColorStop(0, hexToRgba(colorRef.current, 0.02));
      grad.addColorStop(1, hexToRgba(colorRef.current, 0.18));
      return grad;
    }

    // Gradient fill для min/max band
    function bandFill(u: uPlot, seriesIdx: number) {
      const ctx = u.ctx;
      const s = u.series[seriesIdx];
      const sc = u.scales[s.scale!];
      if (sc.min == null || sc.max == null) return "transparent";

      const y0 = u.valToPos(sc.min, s.scale!, true);
      const y1 = u.valToPos(sc.max, s.scale!, true);
      const grad = ctx.createLinearGradient(0, y1, 0, y0);
      grad.addColorStop(0, hexToRgba(colorRef.current, 0.0));
      grad.addColorStop(1, hexToRgba(colorRef.current, 0.08));
      return grad;
    }

    // Raw точки маркеры (только при zoomLevel < 30, одиночный режим)
    function drawRawMarkers(u: uPlot, sidx: number) {
      const fromSec = u.scales.x.min;
      const toSec = u.scales.x.max;
      if (fromSec == null || toSec == null) return;
      const spanMs = (toSec - fromSec) * 1000;
      const zoomLevel = Math.max(0, Math.round(Math.log(spanMs / MIN_SPAN_MS) / Math.log(1.25)));
      if (zoomLevel >= 30) return;

      const { ctx } = u;
      const s = u.series[sidx];
      const { left, top, width, height } = u.bbox;
      const dpr = devicePixelRatio || 1;

      const pts = prevPointsRef.current?.[0];
      if (!pts || pts.length === 0) return;

      ctx.save();
      ctx.fillStyle = colorRef.current;

      for (const p of pts) {
        if (p.value == null) continue;
        const tSec = p.ts / 1000 + tzOffRef.current;
        // CSS→buffer пиксели + bbox offset (как в drawDayBands)
        const x = left + u.valToPos(tSec, "x", false) * dpr;
        const y = top + u.valToPos(p.value!, s.scale!, false) * dpr;
        if (x < left || x > left + width || y < top || y > top + height) continue;

        ctx.beginPath();
        ctx.arc(x, y, 3 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    // ── Полночь в сдвинутом времени (точно 00:00 local) ────────────────────
    function midnightBefore(shiftedSec: number): number {
      // shiftedSec = UTC_sec + tzOffset — на X-оси выглядит как local time
      // Находим 00:00:00.000 этого «дня»
      const ms = shiftedSec * 1000;
      const d = new Date(ms);
      d.setUTCHours(0, 0, 0, 0);
      return d.getTime() / 1000;
    }

    // ── Суточные полосы + метки дат (на uPlot canvas) ───────────────────────
    function drawDayBands(u: uPlot) {
      const { ctx } = u;
      const { left, top, width, height } = u.bbox;
      const dpr = devicePixelRatio || 1;

      const fromSec = u.scales.x.min;
      const toSec = u.scales.x.max;
      if (fromSec == null || toSec == null) return;

      // valToPos возвращает CSS-пиксели, но canvas draw работает в buffer-пикселях.
      // Конвертируем: buffer_x = bbox.left + valToPos(CSS) * DPR
      const xToBuf = (sec: number) => left + u.valToPos(sec, "x", false) * dpr;

      const daySec = midnightBefore(fromSec);
      const firstDay = Math.round(daySec / DAY_SEC);

      ctx.save();

      // ── Полосы через день ──
      let dayIndex = 0;
      let curSec = daySec;
      while (curSec < toSec) {
        const dayEnd = curSec + DAY_SEC;
        const isOdd = (firstDay + dayIndex) % 2 === 1;

        if (isOdd) {
          const x1 = Math.max(left, xToBuf(curSec));
          const x2 = Math.min(left + width, xToBuf(dayEnd));
          if (x2 > x1) {
            ctx.fillStyle = "rgba(148, 163, 184, 0.06)";
            ctx.fillRect(x1, top, x2 - x1, height);
          }
        }

        curSec = dayEnd;
        dayIndex++;
      }

      // ── Вертикальные линии и метки дат на границах суток ──
      curSec = daySec;
      while (curSec <= toSec) {
        if (curSec >= fromSec) {
          const nx = xToBuf(curSec);

          // Вертикальная линия полночи
          ctx.strokeStyle = "rgba(148, 163, 184, 0.18)";
          ctx.lineWidth = dpr;
          ctx.beginPath();
          ctx.moveTo(nx, top);
          ctx.lineTo(nx, top + height);
          ctx.stroke();

          // Метка даты ("ДД.ММ") справа от линии
          const d = new Date(curSec * 1000);
          const DD = String(d.getUTCDate()).padStart(2, "0");
          const MM = String(d.getUTCMonth() + 1).padStart(2, "0");
          const dateLabel = `${DD}.${MM}`;

          ctx.font = `${11 * dpr}px system-ui, sans-serif`;
          ctx.fillStyle = "rgba(148, 163, 184, 0.8)";
          ctx.fillText(dateLabel, nx + 4 * dpr, top + 14 * dpr);
        }

        curSec += DAY_SEC;
      }

      // ── Если на экране один день без границ — показать дату слева ──
      if (daySec < fromSec) {
        const d = new Date(fromSec * 1000);
        const DD = String(d.getUTCDate()).padStart(2, "0");
        const MM = String(d.getUTCMonth() + 1).padStart(2, "0");
        ctx.font = `${11 * dpr}px system-ui, sans-serif`;
        ctx.fillStyle = "rgba(148, 163, 184, 0.6)";
        ctx.fillText(`${DD}.${MM}`, left + 6 * dpr, top + 14 * dpr);
      }

      // ── «Будущее» (полупрозрачная заливка + пунктирная линия «сейчас») ──
      const nowSec = Date.now() / 1000 + tzOffRef.current;
      if (nowSec > fromSec && nowSec < toSec) {
        const nx = xToBuf(nowSec);

        // Заливка будущего
        const futureRight = left + width;
        if (futureRight > nx) {
          ctx.fillStyle = "rgba(59, 130, 246, 0.04)";
          ctx.fillRect(nx, top, futureRight - nx, height);
        }

        // Пунктирная линия «сейчас»
        ctx.strokeStyle = "rgba(59, 130, 246, 0.3)";
        ctx.lineWidth = dpr;
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.beginPath();
        ctx.moveTo(nx, top);
        ctx.lineTo(nx, top + height);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    }

    // ── Gap-зоны (на uPlot canvas) ─────────────────────────────────────────
    function drawGapZones(u: uPlot) {
      const currentGaps = gapsRef.current;
      if (!currentGaps.length) return;

      const { ctx } = u;
      const { left, top, width, height } = u.bbox;
      const dpr = devicePixelRatio || 1;

      const fromSec = u.scales.x.min;
      const toSec = u.scales.x.max;
      if (fromSec == null || toSec == null) return;

      const xToBuf = (sec: number) => left + u.valToPos(sec, "x", false) * dpr;

      ctx.save();

      for (const gap of currentGaps) {
        const gapFromSec = gap.from / 1000 + tzOffRef.current;
        const gapToSec = gap.to != null
          ? gap.to / 1000 + tzOffRef.current
          : toSec;

        if (gapToSec < fromSec || gapFromSec > toSec) continue;

        const x1 = Math.max(left, xToBuf(gapFromSec));
        const x2 = Math.min(left + width, xToBuf(gapToSec));

        if (x2 > x1) {
          ctx.fillStyle = "rgba(239, 68, 68, 0.12)";
          ctx.fillRect(x1, top, x2 - x1, height);

          ctx.fillStyle = "rgba(239, 68, 68, 0.35)";
          ctx.fillRect(x1, top, dpr, height);
          if (gap.to != null) {
            ctx.fillRect(x2 - dpr, top, dpr, height);
          }
        }
      }

      ctx.restore();
    }

    const yRange = (_u: uPlot, min: number, max: number): [number, number] => {
      const top = max + (max - Math.min(min, 0)) * 0.05 || 1;
      return [Math.min(0, min), top];
    };

    const yValues = (_u: uPlot, vals: number[]) => {
      let prev = "";
      return vals.map((v) => {
        const label = v >= 10000 ? (v / 1000).toFixed(1) + "k" : Math.round(v).toString();
        if (label === prev) return "";
        prev = label;
        return label;
      });
    };

    const axes: uPlot.Axis[] = [
      {
        // X axis (time) — 24-часовой формат
        stroke: "#94a3b8",
        grid: { stroke: "rgba(148,163,184,0.06)", width: 1 },
        ticks: { stroke: "rgba(148,163,184,0.06)", width: 1 },
        font: "12px system-ui, sans-serif",
        gap: 8,
        values: (_u: uPlot, splits: number[]) => {
          const spanSec = (_u.scales.x.max ?? 0) - (_u.scales.x.min ?? 0);
          let prev = "";
          return splits.map((s) => {
            const d = new Date(s * 1000);
            const hh = String(d.getUTCHours()).padStart(2, "0");
            const mm = String(d.getUTCMinutes()).padStart(2, "0");
            const ss = String(d.getUTCSeconds()).padStart(2, "0");
            const DD = String(d.getUTCDate()).padStart(2, "0");
            const MM = String(d.getUTCMonth() + 1).padStart(2, "0");

            let label: string;
            if (spanSec > 86400) {
              label = `${DD}.${MM}\n${hh}:${mm}`;
            } else if (spanSec < 120) {
              label = `${hh}:${mm}:${ss}`;
            } else {
              label = `${hh}:${mm}`;
            }

            if (label === prev) return "";
            prev = label;
            return label;
          });
        },
      },
      {
        // Y axis — целые числа, справа
        side: 1,
        scale: "y",
        stroke: "#94a3b8",
        grid: { stroke: "rgba(148,163,184,0.06)", width: 1 },
        ticks: { stroke: "rgba(148,163,184,0.06)", width: 1 },
        font: "12px system-ui, sans-serif",
        size: 60,
        gap: 8,
        values: yValues,
      },
    ];

    if (hasSecondScale) {
      axes.push({
        // Вторая ось Y — слева (другая единица измерения, напр. °C)
        side: 3,
        scale: "y2",
        stroke: "#94a3b8",
        grid: { show: false },
        ticks: { stroke: "rgba(148,163,184,0.06)", width: 1 },
        font: "12px system-ui, sans-serif",
        size: 54,
        gap: 8,
        values: yValues,
      });
    }

    const scales: uPlot.Scales = {
      x: { time: true },
      y: { auto: true, range: yRange },
    };
    if (hasSecondScale) {
      scales.y2 = { auto: true, range: yRange };
    }

    const uSeries: uPlot.Series[] = [{}]; // x series (timestamps)
    if (single) {
      uSeries.push(
        {
          label: series[0]?.label ?? "",
          stroke: () => colorRef.current,
          width: 2,
          fill: areaFill as unknown as string,
          points: { show: false },
          spanGaps: true,
          scale: "y",
        },
        {
          label: "Min",
          stroke: "transparent",
          fill: bandFill as unknown as string,
          points: { show: false },
          spanGaps: true,
          scale: "y",
        },
        {
          label: "Max",
          stroke: "transparent",
          fill: bandFill as unknown as string,
          points: { show: false },
          spanGaps: true,
          scale: "y",
        },
      );
    } else {
      for (const s of series) {
        uSeries.push({
          label: s.label,
          stroke: s.color,
          width: 2,
          points: { show: false },
          spanGaps: true,
          scale: scaleFor(s.unit),
        });
      }
    }

    const opts: uPlot.Options = {
      id: "history-chart",
      width: W,
      height: H,
      // Наши X-значения = UTC_sec + tzOffset — выглядят как local time в UTC.
      // Без tzDate uPlot использует часовой пояс браузера для генерации тиков,
      // что сдвигает границы суток. Форсируем UTC-интерпретацию.
      tzDate: (ts) => {
        const d = new Date(ts * 1e3);
        return new Date(d.getTime() + d.getTimezoneOffset() * 6e4);
      },
      cursor: {
        x: true,
        y: true,
        drag: { x: true, y: false, setScale: false },
        sync: { key: "history" },
      },
      select: { show: false, left: 0, top: 0, width: 0, height: 0 },
      legend: { show: false },
      axes,
      scales,
      series: uSeries,
      bands: single
        ? [{ series: [2, 3], fill: hexToRgba(series[0]?.color ?? "#22c55e", 0.08) }]
        : [],
      hooks: {
        draw: [
          (u: uPlot) => {
            drawDayBands(u);
            drawGapZones(u);
          },
        ],
        drawSeries: [
          (u: uPlot, sidx: number) => {
            if (single && sidx === 1) drawRawMarkers(u, sidx);
          },
        ],
        setScale: [
          (u: uPlot, scaleKey: string) => {
            if (scaleKey !== "x" || suppressRef.current) return;

            const min = u.scales.x.min;
            const max = u.scales.x.max;
            if (min == null || max == null) return;

            const off = tzOffRef.current;
            const from = (min - off) * 1000;
            const to = (max - off) * 1000;
            if (to - from < MIN_SPAN_MS * 0.8) return;

            appliedVpRef.current = { from, to };

            clearTimeout(panTimerRef.current);
            panTimerRef.current = setTimeout(() => {
              onPanRef.current({ from, to });
            }, 80);

          },
        ],
        ready: [
          (u: uPlot) => {

            const over = u.over;

            let dragStartX: number | null = null;
            let dragStartMin: number | null = null;
            let dragStartMax: number | null = null;

            over.addEventListener("mousedown", (e: MouseEvent) => {
              if (e.button !== 0) return;
              isDraggingRef.current = true;
              dragStartX = e.clientX;
              dragStartMin = u.scales.x.min!;
              dragStartMax = u.scales.x.max!;
              over.style.cursor = "grabbing";
            });

            window.addEventListener("mousemove", (e: MouseEvent) => {
              if (dragStartX == null || dragStartMin == null || dragStartMax == null) return;

              const dx = e.clientX - dragStartX;
              const pxPerSec = u.over.clientWidth / (dragStartMax - dragStartMin);
              const dtSec = dx / pxPerSec;

              suppressRef.current = true;
              u.setScale("x", {
                min: dragStartMin - dtSec,
                max: dragStartMax - dtSec,
              });
              suppressRef.current = false;

              const off = tzOffRef.current;
              const from = (dragStartMin - dtSec - off) * 1000;
              const to = (dragStartMax - dtSec - off) * 1000;
              appliedVpRef.current = { from, to };

              clearTimeout(panTimerRef.current);
              panTimerRef.current = setTimeout(() => {
                onPanRef.current({ from, to });
              }, 80);

            });

            window.addEventListener("mouseup", () => {
              if (dragStartX == null) return;
              dragStartX = null;
              dragStartMin = null;
              dragStartMax = null;
              isDraggingRef.current = false;
              over.style.cursor = "crosshair";

              const hadPending = panTimerRef.current !== undefined;
              if (hadPending) {
                clearTimeout(panTimerRef.current);
                panTimerRef.current = undefined;
                onPanRef.current(appliedVpRef.current);
              }

              const pending = pendingDataRef.current;
              if (pending) {
                pendingDataRef.current = null;
                applyDataToChart(pending);
              }

              if (!hadPending) {
                const engineVp = viewportPropRef.current;
                const chartVp = appliedVpRef.current;
                const drift = Math.abs(engineVp.from - chartVp.from) + Math.abs(engineVp.to - chartVp.to);
                if (drift > 500) {
                  appliedVpRef.current = engineVp;
                  suppressRef.current = true;
                  u.setScale("x", {
                    min: engineVp.from / 1000 + tzOffRef.current,
                    max: engineVp.to / 1000 + tzOffRef.current,
                  });
                  requestAnimationFrame(() => {
                    suppressRef.current = false;
                        });
                }
              }
            });

            // Custom zoom (wheel)
            over.addEventListener("wheel", (e: WheelEvent) => {
              e.preventDefault();
              const rect = over.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const xSec = u.posToVal(x, "x");
              if (xSec == null) return;
              const cursorMs = (xSec - tzOffRef.current) * 1000;
              const zoomIn = e.deltaY < 0;
              suppressRef.current = true;
              onZoomRef.current(cursorMs, zoomIn);
            }, { passive: false });

            over.style.cursor = "crosshair";
          },
        ],
      },
      plugins: [
        tooltipPlugin(metaRef, singleRef),
      ],
    };

    const initData: uPlot.AlignedData = single
      ? [[], [], [], []]
      : ([[], ...series.map(() => [])] as unknown as uPlot.AlignedData);
    const u = new uPlot(opts, initData, el);
    chartRef.current = u;

    // После пересоздания (смена состава серий) — переналить уже имеющиеся данные
    prevPointsRef.current = null;

    const ro = new ResizeObserver(() => {
      if (el) {
        u.setSize({ width: el.clientWidth, height: el.clientHeight });
      }
    });
    ro.observe(el);

    return () => {
      clearTimeout(panTimerRef.current);
      ro.disconnect();
      u.destroy();
      chartRef.current = null;
      prevPointsRef.current = null; // Сброс для React StrictMode double-mount
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesSig]);

  /* ── Загрузка / обновление данных ────────────────────────────────────── */
  useEffect(() => {
    if (!chartRef.current) return;

    const ptsArr = series.map((s) => s.points);
    const prev = prevPointsRef.current;
    const same =
      prev != null &&
      prev.length === ptsArr.length &&
      prev.every((p, i) => p === ptsArr[i]);
    if (same) return;

    if (isDraggingRef.current) {
      pendingDataRef.current = ptsArr;
      return;
    }

    applyDataToChart(ptsArr);
  }, [series, applyDataToChart]);

  /* ── Перерисовка при обновлении gap-зон ──────────────────────────────── */
  useEffect(() => {
    chartRef.current?.redraw();
  }, [gaps]);

  /* ── Пересчёт при смене часового пояса ─────────────────────────────── */
  useEffect(() => {
    const u = chartRef.current;
    if (!u || !prevPointsRef.current) return;

    applyDataToChart(prevPointsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tzOffsetHours]);

  /* ── Viewport из engine (zoom, refresh) ──────────────────────────────── */
  useEffect(() => {
    appliedVpRef.current = viewport;
    if (isDraggingRef.current) return;

    const u = chartRef.current;
    if (!u) return;

    suppressRef.current = true;
    u.setScale("x", {
      min: viewport.from / 1000 + tzOffRef.current,
      max: viewport.to / 1000 + tzOffRef.current,
    });
    requestAnimationFrame(() => {
      suppressRef.current = false;
    });
     
  }, [viewport]);

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <div className="relative w-full">
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute top-0 left-0 right-0 z-20 h-0.5 overflow-hidden rounded-t-xl">
          <div className="h-full w-1/3 animate-[slide_1s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-primary to-transparent" />
        </div>
      )}

      {/* Легенда серий */}
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: s.color }}
            />
            {s.label}{" "}
            <span className="text-muted-foreground/50">({s.unit})</span>
          </span>
        ))}
      </div>

      {/* Chart */}
      <div className="relative">
        {/* Высота задаётся императивно (fitChartHeight) — под остаток окна */}
        <div ref={containerRef} className="min-h-[260px] w-full rounded-xl overflow-hidden" />

      </div>
    </div>
  );
}

/* ── Tooltip plugin ────────────────────────────────────────────────────── */

function tooltipPlugin(
  metaRef: React.RefObject<SeriesMeta[]>,
  singleRef: React.RefObject<boolean>,
) {
  let tooltipEl: HTMLDivElement | null = null;

  function init(u: uPlot) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "uplot-tooltip";
    tooltipEl.style.cssText = `
      position: absolute;
      pointer-events: none;
      z-index: 100;
      padding: 6px 10px;
      border-radius: 6px;
      background: rgba(15, 23, 42, 0.92);
      border: 1px solid rgba(148, 163, 184, 0.15);
      color: #e2e8f0;
      font-size: 12px;
      font-family: system-ui, sans-serif;
      white-space: nowrap;
      display: none;
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    u.over.appendChild(tooltipEl);
  }

  function setCursor(u: uPlot) {
    if (!tooltipEl) return;
    const cx = u.cursor.left;
    const cy = u.cursor.top;
    if (cx == null || cy == null || cx < 0) {
      tooltipEl.style.display = "none";
      return;
    }

    const timeSec = u.posToVal(cx, "x");
    if (timeSec == null) {
      tooltipEl.style.display = "none";
      return;
    }

    const { idx } = u.cursor;
    const meta = metaRef.current ?? [];

    const d = new Date(timeSec * 1000);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    const ss = String(d.getUTCSeconds()).padStart(2, "0");
    const DD = String(d.getUTCDate()).padStart(2, "0");
    const MM = String(d.getUTCMonth() + 1).padStart(2, "0");
    const timeStr = `${hh}:${mm}:${ss}`;
    const dateStr = `${DD}.${MM}`;

    let rows: string;
    if (singleRef.current) {
      const val = idx != null ? u.data[1]?.[idx] : null;
      rows = `<div style="color: ${meta[0]?.color ?? "#22c55e"}; font-weight: 600">${formatVal(val)}</div>`;
    } else {
      rows = meta
        .map((m, i) => {
          const val = idx != null ? u.data[i + 1]?.[idx] : null;
          return `<div style="color: ${m.color}; font-weight: 600">${m.label}: ${formatVal(val)} <span style="color: rgba(148,163,184,0.6); font-weight: 400">${m.unit}</span></div>`;
        })
        .join("");
    }

    tooltipEl.innerHTML = `
      <div style="color: rgba(148,163,184,0.7); margin-bottom: 2px">${dateStr} ${timeStr}</div>
      ${rows}
    `;
    tooltipEl.style.display = "block";

    const tw = tooltipEl.offsetWidth;
    let left = cx + 12;
    if (left + tw > u.width) left = cx - tw - 12;

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${cy - 20}px`;
  }

  return {
    hooks: {
      init: [init],
      setCursor: [setCursor],
    },
  };
}
