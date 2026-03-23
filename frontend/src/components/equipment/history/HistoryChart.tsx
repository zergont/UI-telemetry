import { useEffect, useRef, useCallback } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { MIN_SPAN_MS } from "./constants";
import type { ChartPoint, ViewportRange } from "./types";
import type { GapMs } from "@/hooks/use-chart-engine";

/* ── Props ──────────────────────────────────────────────────────────────── */

interface HistoryChartProps {
  data: ChartPoint[];
  gaps: GapMs[];
  label: string;
  unit: string;
  color: string;
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

/** Подготовка данных: ChartPoint[] → uPlot aligned data */
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

/* ── Component ──────────────────────────────────────────────────────────── */

export function HistoryChart({
  data,
  gaps,
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
  const chartRef = useRef<uPlot | null>(null);
  const prevDataRef = useRef<ChartPoint[] | null>(null);
  const appliedVpRef = useRef<ViewportRange>(viewport);
  const viewportPropRef = useRef(viewport);
  viewportPropRef.current = viewport;

  const onZoomRef = useRef(onZoom);
  const onPanRef = useRef(onPan);
  const colorRef = useRef(color);
  onZoomRef.current = onZoom;
  onPanRef.current = onPan;
  colorRef.current = color;

  const tzOffRef = useRef(tzOffsetHours * 3600);
  tzOffRef.current = tzOffsetHours * 3600;

  const futureRef = useRef<HTMLDivElement>(null);
  const gapsRef = useRef<GapMs[]>(gaps);
  gapsRef.current = gaps;

  // Таймер debounce пана
  const panTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Подавление событий scale change (наш zoom, не пользовательский pan)
  const suppressRef = useRef(false);
  // Drag состояние
  const isDraggingRef = useRef(false);
  const pendingDataRef = useRef<ChartPoint[] | null>(null);

  /* ── Голубая полоска «будущее» (DOM-элемент, не canvas) ────────────────── */
  const updateFutureStripe = useCallback(() => {
    const u = chartRef.current;
    const el = futureRef.current;
    const container = containerRef.current;
    if (!u || !el || !container) return;

    const now = Date.now();
    const nowSec = now / 1000 + tzOffRef.current;
    const coord = u.valToPos(nowSec, "x", true);
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

  /* ── Применение данных к графику ─────────────────────────────────────── */
  const applyDataToChart = useCallback(
    (pts: ChartPoint[]) => {
      const u = chartRef.current;
      if (!u) return;

      prevDataRef.current = pts;

      const uData = toUPlotData(pts, tzOffRef.current);
      u.setData(uData, false);

      const vp = appliedVpRef.current;
      suppressRef.current = true;
      u.setScale("x", {
        min: vp.from / 1000 + tzOffRef.current,
        max: vp.to / 1000 + tzOffRef.current,
      });
      requestAnimationFrame(() => {
        suppressRef.current = false;
        updateFutureStripe();
      });
    },
    [updateFutureStripe],
  );

  /* ── Создание графика (один раз) ───────────────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;

    const el = containerRef.current;
    const W = el.clientWidth;
    const H = 400;

    // Gradient fill для area
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

    // Raw точки маркеры
    function drawRawMarkers(u: uPlot, sidx: number) {
      const { ctx } = u;
      const s = u.series[sidx];

      const pts = prevDataRef.current;
      if (!pts) return;

      const realRaw = pts.filter(
        (p) => p.value !== null && (p.sampleCount == null || p.sampleCount <= 1),
      );
      const realNonNull = pts.filter((p) => p.value !== null);
      const isRaw = realRaw.length > 0 && realRaw.length > realNonNull.length * 0.5;
      if (!isRaw || realRaw.length > 2000) return;

      ctx.save();
      ctx.fillStyle = colorRef.current;

      for (const p of realRaw) {
        const tSec = p.ts / 1000 + tzOffRef.current;
        const x = u.valToPos(tSec, "x", true);
        const y = u.valToPos(p.value!, s.scale!, true);
        if (x == null || y == null || x < 0 || x > u.width) continue;

        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    // ── Суточные полосы (на uPlot canvas) ──────────────────────────────────
    function drawDayBands(u: uPlot) {
      const { ctx } = u;
      const { left, top, width, height } = u.bbox;
      const dpr = devicePixelRatio || 1;

      const fromSec = u.scales.x.min;
      const toSec = u.scales.x.max;
      if (fromSec == null || toSec == null) return;

      // Начало первого дня (UTC, в секундах)
      let daySec = Math.floor(fromSec / DAY_SEC) * DAY_SEC;
      const epochDayNum = Math.floor(daySec / DAY_SEC);

      ctx.save();
      ctx.fillStyle = "rgba(148, 163, 184, 0.08)";

      let dayIndex = 0;
      while (daySec < toSec) {
        const dayEnd = daySec + DAY_SEC;
        const isOdd = (epochDayNum + dayIndex) % 2 === 1;

        if (isOdd) {
          const x1 = Math.max(left, u.valToPos(daySec, "x", false));
          const x2 = Math.min(left + width, u.valToPos(dayEnd, "x", false));
          if (x2 > x1) {
            ctx.fillRect(x1, top, x2 - x1, height);
          }
        }

        daySec = dayEnd;
        dayIndex++;
      }

      // Линия "сейчас"
      const nowSec = Date.now() / 1000 + tzOffRef.current;
      if (nowSec > fromSec && nowSec < toSec) {
        const nx = u.valToPos(nowSec, "x", false);
        ctx.strokeStyle = "rgba(59, 130, 246, 0.25)";
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

      ctx.save();

      for (const gap of currentGaps) {
        const gapFromSec = gap.from / 1000 + tzOffRef.current;
        const gapToSec = gap.to != null
          ? gap.to / 1000 + tzOffRef.current
          : toSec;

        if (gapToSec < fromSec || gapFromSec > toSec) continue;

        const x1 = Math.max(left, u.valToPos(gapFromSec, "x", false));
        const x2 = Math.min(left + width, u.valToPos(gapToSec, "x", false));

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

    const opts: uPlot.Options = {
      id: "history-chart",
      width: W,
      height: H,
      cursor: {
        x: true,
        y: true,
        drag: { x: true, y: false, setScale: false },
        sync: { key: "history" },
      },
      select: { show: false, left: 0, top: 0, width: 0, height: 0 },
      legend: { show: false },
      axes: [
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
          stroke: "#94a3b8",
          grid: { stroke: "rgba(148,163,184,0.06)", width: 1 },
          ticks: { stroke: "rgba(148,163,184,0.06)", width: 1 },
          font: "12px system-ui, sans-serif",
          size: 60,
          gap: 8,
          values: (_u: uPlot, vals: number[]) =>
            vals.map((v) => (v >= 10000 ? (v / 1000).toFixed(1) + "k" : Math.round(v).toString())),
        },
      ],
      scales: {
        x: { time: false },
        y: { auto: true, range: (_u, min, max) => {
          const top = max + (max - Math.min(min, 0)) * 0.05 || 1;
          return [Math.min(0, min), top];
        }},
      },
      series: [
        {}, // x series (timestamps)
        {
          label: label,
          stroke: colorRef.current,
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
      ],
      bands: [
        { series: [2, 3], fill: hexToRgba(colorRef.current, 0.08) },
      ],
      hooks: {
        draw: [
          (u: uPlot) => {
            drawDayBands(u);
            drawGapZones(u);
          },
        ],
        drawSeries: [
          (u: uPlot, sidx: number) => {
            if (sidx === 1) drawRawMarkers(u, sidx);
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

            updateFutureStripe();
          },
        ],
        ready: [
          (u: uPlot) => {
            updateFutureStripe();

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
              const pxPerSec = u.width / (dragStartMax - dragStartMin);
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

              updateFutureStripe();
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
                    updateFutureStripe();
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
        tooltipPlugin(colorRef),
      ],
    };

    const initData: uPlot.AlignedData = [[], [], [], []];
    const u = new uPlot(opts, initData, el);
    chartRef.current = u;

    const ro = new ResizeObserver(() => {
      if (el) {
        u.setSize({ width: el.clientWidth, height: H });
        updateFutureStripe();
      }
    });
    ro.observe(el);

    return () => {
      clearTimeout(panTimerRef.current);
      ro.disconnect();
      u.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Обновление цвета ────────────────────────────────────────────────── */
  useEffect(() => {
    const u = chartRef.current;
    if (!u) return;
    u.series[1].stroke = () => colorRef.current;
    u.redraw();
  }, [color]);

  /* ── Загрузка / обновление данных ────────────────────────────────────── */
  useEffect(() => {
    if (!chartRef.current || data === prevDataRef.current) return;

    if (isDraggingRef.current) {
      pendingDataRef.current = data;
      return;
    }

    applyDataToChart(data);
  }, [data, applyDataToChart]);

  /* ── Перерисовка при обновлении gap-зон ──────────────────────────────── */
  useEffect(() => {
    chartRef.current?.redraw();
  }, [gaps]);

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
      updateFutureStripe();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      {/* Label */}
      <div className="text-xs text-muted-foreground mb-1">
        {label} <span className="text-muted-foreground/50">({unit})</span>
      </div>

      {/* Chart */}
      <div className="relative">
        <div ref={containerRef} className="h-[400px] w-full rounded-xl overflow-hidden" />

        {/* Future stripe */}
        <div
          ref={futureRef}
          className="absolute top-0 pointer-events-none z-10"
          style={{
            display: "none",
            bottom: "30px",
            background: "rgba(59, 130, 246, 0.06)",
            borderLeft: "1px dashed rgba(59, 130, 246, 0.25)",
          }}
        />
      </div>
    </div>
  );
}

/* ── Tooltip plugin ────────────────────────────────────────────────────── */

function tooltipPlugin(colorRef: React.RefObject<string>) {
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
    const val = idx != null ? u.data[1][idx] : null;

    const d = new Date(timeSec * 1000);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    const ss = String(d.getUTCSeconds()).padStart(2, "0");
    const DD = String(d.getUTCDate()).padStart(2, "0");
    const MM = String(d.getUTCMonth() + 1).padStart(2, "0");
    const timeStr = `${hh}:${mm}:${ss}`;
    const dateStr = `${DD}.${MM}`;

    const valStr = val != null
      ? (val >= 10000 ? (val / 1000).toFixed(2) + "k" : Math.round(val).toString())
      : "—";

    tooltipEl.innerHTML = `
      <div style="color: rgba(148,163,184,0.7); margin-bottom: 2px">${dateStr} ${timeStr}</div>
      <div style="color: ${colorRef.current}; font-weight: 600">${valStr}</div>
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
