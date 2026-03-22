import { useEffect, useRef, useCallback } from "react";
import {
  createChart,
  createSeriesMarkers,
  AreaSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type LineWidth,
} from "lightweight-charts";
import { MIN_SPAN_MS } from "./constants";
import type { ChartPoint, ViewportRange } from "./types";

/* ── Props ──────────────────────────────────────────────────────────────── */

interface HistoryChartProps {
  data: ChartPoint[];
  label: string;
  unit: string;
  color: string;
  viewport: ViewportRange;
  isLoading: boolean;
  /** Смещение часового пояса в часах от UTC (для отображения на оси) */
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

/** Начало суток (00:00) для LWC-timestamp в ms (уже со сдвигом tz) */
function startOfDayShifted(shiftedMs: number): number {
  // shiftedMs уже содержит tz offset, поэтому UTC-midnight по сдвинутому = полночь в нужном tz
  const d = new Date(shiftedMs);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

const DAY_MS = 86_400_000;

/* ── Component ──────────────────────────────────────────────────────────── */

export function HistoryChart({
  data,
  label,
  unit,
  color,
  viewport,
  isLoading,
  tzOffsetHours,
  onZoom,
  onPan,
}: HistoryChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mainRef = useRef<ISeriesApi<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bandTopRef = useRef<ISeriesApi<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bandBotRef = useRef<ISeriesApi<any> | null>(null);

  // Плагин маркеров для raw точек
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  /** true → игнорируем события visibleTimeRangeChange (мы сами двигаем viewport) */
  const suppressRef = useRef(true);
  const prevDataRef = useRef<ChartPoint[] | null>(null);
  const appliedVpRef = useRef<ViewportRange>(viewport);

  // Ref для viewport prop — нужен в mouseup чтобы скорректировать позицию после clamping
  const viewportPropRef = useRef(viewport);
  viewportPropRef.current = viewport;

  // Refs для колбэков — чтобы chart init effect не пересоздавался
  const onZoomRef = useRef(onZoom);
  const onPanRef = useRef(onPan);
  const colorRef = useRef(color);
  onZoomRef.current = onZoom;
  onPanRef.current = onPan;
  colorRef.current = color;

  // Timezone offset: UTC ms → LWC "визуальные" секунды и обратно.
  // LWC не поддерживает timezone — фейкаем, сдвигая timestamps.
  // Timezone offset в секундах. LWC не поддерживает timezone нативно —
  // мы сдвигаем timestamps на offset, чтобы ось X показывала локальное время.
  const tzOffRef = useRef(tzOffsetHours * 3600);
  tzOffRef.current = tzOffsetHours * 3600;

  // Для голубой полоски «будущее»
  const futureRef = useRef<HTMLDivElement>(null);
  // Для canvas суточных полос
  const dayBandsRef = useRef<HTMLCanvasElement>(null);
  // Таймер debounce пана
  const panTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Отложенное применение данных: не вызываем setData() пока пользователь тянет мышку
  const isDraggingRef = useRef(false);
  const pendingDataRef = useRef<ChartPoint[] | null>(null);

  /* ── Применение данных к графику (вынесено, чтобы вызывать и из effect, и из mouseup) */
  const applyDataToChart = useCallback((pts: ChartPoint[]) => {
    const chart = chartRef.current;
    const main = mainRef.current;
    const bandTop = bandTopRef.current;
    const bandBot = bandBotRef.current;
    if (!chart || !main) return;

    prevDataRef.current = pts;

    // Main area (avg) — применяем timezone offset
    const off = tzOffRef.current;
    const lwMain = pts.map((p) =>
      p.value === null
        ? { time: ((p.ts / 1000) + off) as Time }
        : { time: ((p.ts / 1000) + off) as Time, value: p.value },
    );

    // Min/Max band (только для агрегированных данных)
    const hasAgg = pts.some(
      (p) =>
        p.value !== null &&
        p.sampleCount != null &&
        p.sampleCount > 1 &&
        p.minValue != null &&
        p.maxValue != null &&
        p.minValue !== p.maxValue,
    );

    const topData = hasAgg
      ? pts
          .filter((p) => p.value !== null)
          .map((p) => ({
            time: ((p.ts / 1000) + off) as Time,
            value:
              p.maxValue != null && p.sampleCount != null && p.sampleCount > 1
                ? p.maxValue
                : p.value!,
          }))
      : [];

    const botData = hasAgg
      ? pts
          .filter((p) => p.value !== null)
          .map((p) => ({
            time: ((p.ts / 1000) + off) as Time,
            value:
              p.minValue != null && p.sampleCount != null && p.sampleCount > 1
                ? p.minValue
                : p.value!,
          }))
      : [];

    // Определяем: raw данные? (считаем только реальные точки, без synthetic)
    const realRawPoints = pts.filter(
      (p) => p.value !== null && !p.synthetic && (p.sampleCount == null || p.sampleCount <= 1),
    );
    const realNonNull = pts.filter((p) => p.value !== null && !p.synthetic);
    const isRaw = realRawPoints.length > 0 && realRawPoints.length > realNonNull.length * 0.5;

    // Применяем данные и восстанавливаем viewport без мерцания
    suppressRef.current = true;
    main.setData(lwMain);
    bandTop?.setData(topData);
    bandBot?.setData(botData);

    // Маркеры только на реальных raw точках (не synthetic, не агрегированных)
    if (isRaw && realRawPoints.length <= 2000) {
      const markers = realRawPoints.map((p) => ({
        time: ((p.ts / 1000) + off) as Time,
        position: "inBar" as const,
        color: colorRef.current,
        shape: "circle" as const,
        size: 0.1,
      }));
      if (markersRef.current) {
        markersRef.current.setMarkers(markers);
      } else {
        markersRef.current = createSeriesMarkers(main, markers);
      }
    } else if (markersRef.current) {
      markersRef.current.setMarkers([]);
    }

    // Восстановить viewport (с tz offset)
    const vp = appliedVpRef.current;
    requestAnimationFrame(() => {
      if (!chartRef.current) return;
      suppressRef.current = true;
      try {
        chartRef.current.timeScale().setVisibleRange({
          from: ((vp.from / 1000) + tzOffRef.current) as Time,
          to: ((vp.to / 1000) + tzOffRef.current) as Time,
        });
      } catch { /* timeScale not ready */ }
      requestAnimationFrame(() => {
        suppressRef.current = false;
        drawDayBands();
        updateFutureStripe();
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Рисование суточных полос ────────────────────────────────────────── */
  const drawDayBands = useCallback(() => {
    const chart = chartRef.current;
    const canvas = dayBandsRef.current;
    const container = containerRef.current;
    if (!chart || !canvas || !container) return;

    const W = container.clientWidth;
    // Высота chart area (без timeScale ~28px)
    const H = container.clientHeight - 28;
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const ts = chart.timeScale();
    const range = ts.getVisibleRange();
    if (!range) return;

    const fromMs = (range.from as number) * 1000;
    const toMs = (range.to as number) * 1000;

    // Находим начало первого видимого дня (fromMs/toMs уже в shifted координатах LWC)
    let dayStart = startOfDayShifted(fromMs);
    let dayIndex = 0;

    // Определяем чётность первого дня (по кол-ву дней от epoch)
    const epochDayNum = Math.floor(dayStart / DAY_MS);

    while (dayStart < toMs) {
      const dayEnd = dayStart + DAY_MS;
      const isOdd = (epochDayNum + dayIndex) % 2 === 1;

      if (isOdd) {
        const x1 = ts.timeToCoordinate((dayStart / 1000) as Time);
        const x2 = ts.timeToCoordinate((dayEnd / 1000) as Time);

        if (x1 != null && x2 != null) {
          const left = Math.max(0, x1);
          const right = Math.min(W, x2);
          if (right > left) {
            ctx.fillStyle = "rgba(148, 163, 184, 0.10)";
            ctx.fillRect(left, 0, right - left, H);
          }
        }
      }

      dayStart = dayEnd;
      dayIndex++;
    }
  }, []);

  /* ── Создание графика (один раз) ───────────────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94a3b8",
        fontSize: 12,
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.06)" },
        horzLines: { color: "rgba(148,163,184,0.06)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { labelVisible: true },
        horzLine: { labelVisible: true },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: true,
        lockVisibleTimeRangeOnResize: true,
      },
      // Pan встроенный (LWC делает плавно), zoom — наш кастомный
      handleScroll: true,
      handleScale: false,
    });

    // ── Band top (max) ─────────────────────────────────────────────
    const bandTop = chart.addSeries(AreaSeries, {
      lineWidth: 1 as LineWidth,
      lineColor: "transparent",
      topColor: hexToRgba("#22c55e", 0.08),
      bottomColor: "transparent",
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // ── Band bottom (min) — перекрывает нижнюю часть bandTop ───────
    const bandBot = chart.addSeries(AreaSeries, {
      lineWidth: 1 as LineWidth,
      lineColor: "transparent",
      topColor: "rgba(0,0,0,0)",
      bottomColor: "transparent",
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // ── Main area (avg + зелёная тень под графиком) ──────────────
    const main = chart.addSeries(AreaSeries, {
      lineColor: "#22c55e",
      lineWidth: 2,
      topColor: hexToRgba("#22c55e", 0.18),
      bottomColor: hexToRgba("#22c55e", 0.02),
      priceLineVisible: true,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });

    chartRef.current = chart;
    mainRef.current = main;
    bandTopRef.current = bandTop;
    bandBotRef.current = bandBot;

    // ── Pan detection (от встроенного drag LWC) ────────────────────
    // Не боремся с LWC — он двигает график плавно сам.
    // Мы только отслеживаем куда пользователь ушёл для подгрузки данных.
    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (suppressRef.current || !range) return;
      // LWC секунды → UTC ms (вычитаем tz offset)
      const from = ((range.from as number) - tzOffRef.current) * 1000;
      const to = ((range.to as number) - tzOffRef.current) * 1000;
      if (to - from < MIN_SPAN_MS * 0.8) return;
      appliedVpRef.current = { from, to };

      // Debounce: не дёргаем React state на каждый кадр пана.
      // LWC сам рендерит плавно, а мы обновляем state только при паузе —
      // это триггерит подгрузку данных, но не мешает анимации.
      clearTimeout(panTimerRef.current);
      panTimerRef.current = setTimeout(() => {
        onPanRef.current({ from, to });
      }, 80);

      // Перерисовать оверлеи синхронно с паном
      drawDayBands();
      updateFutureStripe();
    });

    // При mousedown/touchstart — перестаём подавлять события + трекаем drag
    const el = containerRef.current;

    const onPointerDown = () => {
      suppressRef.current = false;
      isDraggingRef.current = true;
    };
    const onPointerUp = () => {
      isDraggingRef.current = false;

      // Flush pending pan timer so engine viewport is up-to-date
      // before drift correction runs.
      const hadPendingPan = panTimerRef.current !== undefined;
      if (hadPendingPan) {
        clearTimeout(panTimerRef.current);
        panTimerRef.current = undefined;
        onPanRef.current(appliedVpRef.current);
      }

      // Применяем данные, которые пришли во время drag
      const pending = pendingDataRef.current;
      if (pending) {
        pendingDataRef.current = null;
        applyDataToChart(pending);
      }

      // Коррекция: если engine зажал viewport (clamp будущего/прошлого),
      // то LWC показывает не ту позицию. Возвращаем график на место.
      // Если мы только что flush'нули pan — engine скоро обновит viewport
      // через React state, и viewport effect сам поставит chart на место.
      if (!hadPendingPan) {
        const engineVp = viewportPropRef.current;
        const lwcVp = appliedVpRef.current;
        const drift = Math.abs(engineVp.from - lwcVp.from) + Math.abs(engineVp.to - lwcVp.to);
        if (drift > 500) {
          appliedVpRef.current = engineVp;
          suppressRef.current = true;
          requestAnimationFrame(() => {
            if (!chartRef.current) return;
            try {
              chartRef.current.timeScale().setVisibleRange({
                from: ((engineVp.from / 1000) + tzOffRef.current) as Time,
                to: ((engineVp.to / 1000) + tzOffRef.current) as Time,
              });
            } catch { /* */ }
            requestAnimationFrame(() => {
              suppressRef.current = false;
              drawDayBands();
              updateFutureStripe();
            });
          });
        }
      }
    };

    el.addEventListener("mousedown", onPointerDown);
    el.addEventListener("touchstart", onPointerDown, { passive: true });
    window.addEventListener("mouseup", onPointerUp);
    window.addEventListener("touchend", onPointerUp);

    // ── Кастомный zoom (wheel → zoomAtCursor) ──────────────────────
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ts = chart.timeScale();
      const cursorTime = ts.coordinateToTime(x);
      if (cursorTime == null) return;
      const cursorMs = ((cursorTime as number) - tzOffRef.current) * 1000;
      const zoomIn = e.deltaY < 0;
      suppressRef.current = true;
      onZoomRef.current(cursorMs, zoomIn);
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    // ── ResizeObserver ──────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      if (el) {
        chart.applyOptions({ width: el.clientWidth });
        drawDayBands();
      }
    });
    ro.observe(el);

    return () => {
      clearTimeout(panTimerRef.current);
      el.removeEventListener("mousedown", onPointerDown);
      el.removeEventListener("touchstart", onPointerDown);
      window.removeEventListener("mouseup", onPointerUp);
      window.removeEventListener("touchend", onPointerUp);
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
      markersRef.current?.detach();
      markersRef.current = null;
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
      bandTopRef.current = null;
      bandBotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Обновление цвета серий ────────────────────────────────────────────── */
  useEffect(() => {
    mainRef.current?.applyOptions({
      lineColor: color,
      topColor: hexToRgba(color, 0.18),
      bottomColor: hexToRgba(color, 0.02),
    });
    bandTopRef.current?.applyOptions({ topColor: hexToRgba(color, 0.08) });
  }, [color]);

  /* ── Загрузка / обновление данных ──────────────────────────────────────── */
  useEffect(() => {
    if (!chartRef.current || !mainRef.current || data === prevDataRef.current) return;

    if (isDraggingRef.current) {
      // Пользователь тянет мышку — откладываем setData() до mouseup,
      // иначе LWC пересчитает бар/пиксель и drag превратится в зум.
      pendingDataRef.current = data;
      return;
    }

    applyDataToChart(data);
  }, [data, applyDataToChart]);

  /* ── Viewport из engine (zoom, refresh, начальная загрузка) ─────────────── */
  useEffect(() => {
    appliedVpRef.current = viewport;

    // Во время активного drag LWC сам двигает график.
    // Дёргать setVisibleRange в это время = рывки.
    if (isDraggingRef.current) return;

    const chart = chartRef.current;
    if (!chart) return;

    requestAnimationFrame(() => {
      if (!chartRef.current) return;
      suppressRef.current = true;
      try {
        chartRef.current.timeScale().setVisibleRange({
          from: ((viewport.from / 1000) + tzOffRef.current) as Time,
          to: ((viewport.to / 1000) + tzOffRef.current) as Time,
        });
      } catch { /* not ready */ }
      requestAnimationFrame(() => {
        suppressRef.current = false;
        drawDayBands();
        updateFutureStripe();
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport]);

  /* ── Голубая полоска «будущее» ──────────────────────────────────────────── */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const updateFutureStripe = useCallback(() => {
    const chart = chartRef.current;
    const el = futureRef.current;
    const container = containerRef.current;
    if (!chart || !el || !container) return;

    const now = Date.now();
    const nowSec = ((now / 1000) + tzOffRef.current) as Time;
    const coord = chart.timeScale().timeToCoordinate(nowSec);
    const containerW = container.clientWidth;

    if (coord != null && coord < containerW - 5) {
      const left = Math.max(0, coord);
      el.style.display = "block";
      el.style.left = `${left}px`;
      el.style.width = `${containerW - left}px`;
    } else {
      el.style.display = "none";
    }
  }, []);

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <div className="relative w-full">
      {/* Loading overlay — тонкая полоска сверху, не блокирует взаимодействие */}
      {isLoading && (
        <div className="absolute top-0 left-0 right-0 z-20 h-0.5 overflow-hidden rounded-t-xl">
          <div className="h-full w-1/3 animate-[slide_1s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-primary to-transparent" />
        </div>
      )}

      {/* Заголовок */}
      <div className="text-xs text-muted-foreground mb-1">
        {label} <span className="text-muted-foreground/50">({unit})</span>
      </div>

      {/* Chart container */}
      <div className="relative">
        <div ref={containerRef} className="h-[400px] w-full rounded-xl overflow-hidden" />

        {/* Canvas для суточных полос — поверх графика, но не блокирует клики */}
        <canvas
          ref={dayBandsRef}
          className="absolute top-0 left-0 pointer-events-none"
          style={{ zIndex: 5 }}
        />

        {/* Голубая полоска «будущее» */}
        <div
          ref={futureRef}
          className="absolute top-0 pointer-events-none z-10"
          style={{
            display: "none",
            bottom: "28px",
            background: "rgba(59, 130, 246, 0.06)",
            borderLeft: "1px dashed rgba(59, 130, 246, 0.25)",
          }}
        />
      </div>
    </div>
  );
}
