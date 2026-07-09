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

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useTelemetryStore, makeEquipKey } from "@/stores/telemetry-store";
import {
  CACHE_TRIM_SCREENS,
  DEFAULT_SPAN_MS,
  FETCH_DEBOUNCE_MS,
  FUTURE_PAD_MS,
  LOAD_TRIGGER,
  MAX_POINTS_PER_REQUEST,
  MIN_SPAN_MS,
  PREFETCH_SCREENS,
  ZOOM_SPEED,
} from "@/components/equipment/history/constants";
import {
  buildChartData,
  calcTargetPoints,
  clamp,
  isFiniteNumber,
  mergePoints,
  parseIsoToMs,
  requiredResolutionSecs,
} from "@/components/equipment/history/utils";
import type {
  ChartPoint,
  GapZone,
  HistoryResponse,
  ViewportRange,
} from "@/components/equipment/history/types";

/* ── Types ──────────────────────────────────────────────────────────────── */

/** Gap в миллисекундах (конвертирован из ISO) */
export interface GapMs {
  from: number;  // Unix ms
  to: number | null;  // null = ongoing
}

interface DataCache {
  /** Точки по каждому регистру (порядок = addrs) */
  series: ChartPoint[][];
  gaps: GapMs[];
  /** Фактически загруженный диапазон (loadedTo не заходит дальше now + pad) */
  loadedFrom: number;
  loadedTo: number;
  /** Фактическое разрешение данных, сек/бакет (0 = raw); при merge — грубейшее */
  resolutionSecs: number;
  /** Разрешение, которое запрашивали (сек/точка) — «потолок», чтобы не
   *  долбить бэкенд, когда плотнее данных для диапазона физически нет */
  requestedResSecs: number;
}

interface UseChartEngineOpts {
  routerSn: string;
  equipType: string;
  panelId: string;
  /** Регистры графика; несколько — мультисерийный режим (фазы, масло P+t) */
  addrs: number[];
}

/** Интервал автосдвига viewport в live-режиме (мс) */
const LIVE_SHIFT_INTERVAL_MS = 60_000;

interface UseChartEngineResult {
  /** Текущий видимый диапазон (ms) */
  viewport: ViewportRange;
  /** Загруженные точки по каждому регистру (порядок = addrs) */
  series: ChartPoint[][];
  /** Gap-зоны (разрывы связи) */
  gaps: GapMs[];
  /** Загрузка в процессе */
  isLoading: boolean;
  /** Самая ранняя точка данных в БД (ms) */
  firstDataAt: number | null;
  /** Live-режим: данные дорисовываются в реальном времени */
  isLive: boolean;

  /** Zoom к курсору. zoomIn=true — приближение */
  zoomAtCursor: (cursorTimeMs: number, zoomIn: boolean) => void;
  /** Установить viewport (вызывается при pan из графика) */
  setViewport: (vp: ViewportRange) => void;
  /** Сброс к начальному виду: последние 4 часа, очистка кэша, включение live */
  refresh: () => void;
}

/* ── Fetch helpers ──────────────────────────────────────────────────────── */

function parseGaps(gaps: GapZone[]): GapMs[] {
  return gaps.map((g) => ({
    from: parseIsoToMs(g.gap_start),
    to: g.gap_end ? parseIsoToMs(g.gap_end) : null,
  }));
}

async function fetchRange(
  routerSn: string,
  equipType: string,
  panelId: string,
  addr: number,
  from: number,
  to: number,
  points: number,
  signal?: AbortSignal,
): Promise<{ points: ChartPoint[]; gaps: GapMs[]; firstDataAt: number | null; resolutionSecs: number } | null> {
  const params = new URLSearchParams({
    router_sn: routerSn,
    equip_type: equipType,
    panel_id: panelId,
    addr: String(addr),
    start: new Date(from).toISOString(),
    end: new Date(Math.min(to, Date.now() + FUTURE_PAD_MS)).toISOString(),
    points: String(Math.min(points, MAX_POINTS_PER_REQUEST)),
  });

  try {
    const resp = await apiFetch<HistoryResponse>(`/api/history?${params}`, { signal });
    const pts = buildChartData(resp.points);
    const gaps = parseGaps(resp.gaps ?? []);
    const fda = resp.first_data_at ? parseIsoToMs(resp.first_data_at) : null;
    return {
      points: pts,
      gaps,
      firstDataAt: isFiniteNumber(fda) ? fda : null,
      resolutionSecs: resp.resolution_secs ?? 0,
    };
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    console.error("[chart-engine] fetch error:", e);
    return null;
  }
}

/** Параллельный fetch всех регистров за один диапазон */
async function fetchRangeMulti(
  routerSn: string,
  equipType: string,
  panelId: string,
  addrs: number[],
  from: number,
  to: number,
  points: number,
  signal?: AbortSignal,
): Promise<{ series: ChartPoint[][]; gaps: GapMs[]; firstDataAt: number | null; resolutionSecs: number } | null> {
  const results = await Promise.all(
    addrs.map((addr) =>
      fetchRange(routerSn, equipType, panelId, addr, from, to, points, signal),
    ),
  );
  if (signal?.aborted) return null;
  if (results.every((r) => r == null)) return null;

  // Gap-зоны — разрывы связи, одинаковы для всех регистров панели
  let gaps: GapMs[] = [];
  for (const r of results) {
    if (r) { gaps = r.gaps; break; }
  }
  let firstDataAt: number | null = null;
  let resolutionSecs = 0;
  for (const r of results) {
    if (r?.firstDataAt != null) {
      firstDataAt = firstDataAt == null ? r.firstDataAt : Math.min(firstDataAt, r.firstDataAt);
    }
    // Разрешение по грубейшему из регистров (обычно одинаковое)
    if (r) resolutionSecs = Math.max(resolutionSecs, r.resolutionSecs);
  }
  return { series: results.map((r) => r?.points ?? []), gaps, firstDataAt, resolutionSecs };
}

/* ── Hook ───────────────────────────────────────────────────────────────── */

/** Объединить два списка gap'ов без дубликатов (по gap_start) */
function mergeGaps(a: GapMs[], b: GapMs[]): GapMs[] {
  const map = new Map<number, GapMs>();
  for (const g of a) map.set(g.from, g);
  for (const g of b) map.set(g.from, g);
  return Array.from(map.values()).sort((x, y) => x.from - y.from);
}

/**
 * Подрезка кэша при пане: держим не больше CACHE_TRIM_SCREENS экранов
 * с каждой стороны viewport. Гистерезис в один экран — не резать
 * по чуть-чуть на каждом сдвиге.
 */
function trimCache(cache: DataCache, vp: ViewportRange): void {
  const span = vp.to - vp.from;
  const keepFrom = vp.from - span * CACHE_TRIM_SCREENS;
  const keepTo = vp.to + span * CACHE_TRIM_SCREENS;

  if (cache.loadedFrom < keepFrom - span) {
    cache.series = cache.series.map((pts) => pts.filter((p) => p.ts >= keepFrom));
    cache.loadedFrom = keepFrom;
  }
  if (cache.loadedTo > keepTo + span) {
    cache.series = cache.series.map((pts) => pts.filter((p) => p.ts <= keepTo));
    cache.loadedTo = keepTo;
  }
}

function makeDefaultViewport(): ViewportRange {
  const now = Date.now();
  return { from: now - DEFAULT_SPAN_MS, to: now + FUTURE_PAD_MS };
}

export function useChartEngine({
  routerSn,
  equipType,
  panelId,
  addrs,
}: UseChartEngineOpts): UseChartEngineResult {
  /* ── state ─────────────────────────────────────────────────────────────── */
  const [viewport, setViewportRaw] = useState<ViewportRange>(makeDefaultViewport);
  const [series, setSeries] = useState<ChartPoint[][]>(() => addrs.map(() => []));
  const [gaps, setGaps] = useState<GapMs[]>([]);
  const [firstDataAt, setFirstDataAt] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLive, setIsLive] = useState(true);

  const cacheRef = useRef<DataCache | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  // Live-точки из WS, пришедшие пока первичная загрузка ещё шла (кэша нет)
  const pendingLiveRef = useRef<ChartPoint[][] | null>(null);
  // Автосдвиг viewport в live: следующий запуск data-loader'а пропускаем
  const liveShiftSkipRef = useRef(false);
  const viewportRef = useRef(viewport);
  const firstDataAtRef = useRef(firstDataAt);
  const isLiveRef = useRef(isLive);
  const addrsRef = useRef(addrs);

  const addrsKey = addrs.join(",");

  // Обновляется первым — последующие эффекты этого же коммита видят свежий список
  useEffect(() => { addrsRef.current = addrs; }, [addrs]);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);
  useEffect(() => { firstDataAtRef.current = firstDataAt; }, [firstDataAt]);
  useEffect(() => { isLiveRef.current = isLive; }, [isLive]);

  // Сброс кэша при смене параметра (другие регистры, другое оборудование)
  const paramKey = `${routerSn}/${equipType}/${panelId}/${addrsKey}`;
  const prevParamKey = useRef(paramKey);
  useEffect(() => {
    if (prevParamKey.current !== paramKey) {
      prevParamKey.current = paramKey;
      cacheRef.current = null;
      pendingLiveRef.current = null;
      liveShiftSkipRef.current = false;
      setSeries(addrsRef.current.map(() => []));
      setGaps([]);
      setFirstDataAt(null);
      setIsLoading(true);
      setIsLive(true);
      setViewportRaw(makeDefaultViewport());
    }
  }, [paramKey]);

  /* ── data loader ───────────────────────────────────────────────────────── */
  useEffect(() => {
    // Автосдвиг live: данные приносят WS и минутный fetch — загрузку не гоняем
    if (liveShiftSkipRef.current) {
      liveShiftSkipRef.current = false;
      return;
    }
    clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      const vp = viewportRef.current;
      const span = vp.to - vp.from;
      const requiredRes = requiredResolutionSecs(span);
      const cache = cacheRef.current;
      const curAddrs = addrsRef.current;

      // Полный refetch: кэша нет, либо его данные грубее, чем требует зум.
      // «Потолок»: если покрытый диапазон уже запрашивали не грубее и всё
      // равно получили это разрешение — плотнее в БД нет, не повторяем.
      const coversViewport =
        cache != null && vp.from >= cache.loadedFrom && vp.to <= cache.loadedTo;
      const ceilingReached =
        cache != null && coversViewport && cache.requestedResSecs <= requiredRes;
      const needsFullRefetch =
        !cache || (cache.resolutionSecs > requiredRes && !ceilingReached);

      // Отменяем предыдущий запрос
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      if (needsFullRefetch) {
        // ── Полная перезагрузка (первый раз или зум требует плотнее) ──
        const sideMargin = span * ((PREFETCH_SCREENS - 1) / 2);
        const fetchFrom = vp.from - sideMargin;
        const fetchTo = Math.min(vp.to + sideMargin, Date.now() + FUTURE_PAD_MS);
        const pts = calcTargetPoints(span) * PREFETCH_SCREENS;
        const effPts = Math.min(pts, MAX_POINTS_PER_REQUEST);
        const requestedRes = (fetchTo - fetchFrom) / 1000 / effPts;

        setIsLoading(true);
        fetchRangeMulti(routerSn, equipType, panelId, curAddrs, fetchFrom, fetchTo, pts, ac.signal)
          .then((res) => {
            if (!res || ac.signal.aborted) return;
            // Вливаем live-точки, пришедшие из WS пока шла загрузка
            const pending = pendingLiveRef.current;
            pendingLiveRef.current = null;
            const series = pending
              ? res.series.map((pts0, i) =>
                  pending[i]?.length ? mergePoints(pts0, pending[i]) : pts0)
              : res.series;
            cacheRef.current = {
              series,
              gaps: res.gaps,
              loadedFrom: fetchFrom,
              loadedTo: fetchTo,
              resolutionSecs: res.resolutionSecs,
              requestedResSecs: requestedRes,
            };
            setSeries(series);
            setGaps(res.gaps);
            if (res.firstDataAt != null) setFirstDataAt(res.firstDataAt);
            setIsLoading(false);
          });
      } else {
        // ── Инкрементальная подгрузка (пан в пределах текущего разрешения) ──
        const leftBuf = vp.from - cache.loadedFrom;
        const rightBuf = cache.loadedTo - vp.to;
        const threshold = span * LOAD_TRIGGER;
        const edgePts = Math.round(calcTargetPoints(span) * 1.5);
        const effEdgePts = Math.min(edgePts, MAX_POINTS_PER_REQUEST);

        let promise: Promise<void> = Promise.resolve();
        let didFetch = false;

        if (leftBuf < threshold) {
          // Нужно догрузить слева
          const edgeTo = cache.loadedFrom;
          const edgeFrom = edgeTo - span * 1.5;
          const requestedRes = (edgeTo - edgeFrom) / 1000 / effEdgePts;
          didFetch = true;
          setIsLoading(true);
          promise = fetchRangeMulti(routerSn, equipType, panelId, curAddrs, edgeFrom, edgeTo, edgePts, ac.signal)
            .then((res) => {
              if (!res || ac.signal.aborted) return;
              cache.series = cache.series.map((pts, i) => mergePoints(res.series[i] ?? [], pts));
              cache.gaps = mergeGaps(res.gaps, cache.gaps);
              cache.loadedFrom = edgeFrom;
              cache.resolutionSecs = Math.max(cache.resolutionSecs, res.resolutionSecs);
              cache.requestedResSecs = Math.max(cache.requestedResSecs, requestedRes);
              if (res.firstDataAt != null) setFirstDataAt(res.firstDataAt);
              trimCache(cache, viewportRef.current);
              setSeries(cache.series);
              setGaps(cache.gaps);
            });
        }

        // Справа грузим только до «сейчас» + pad — будущее не запрашиваем
        const maxTo = Date.now() + FUTURE_PAD_MS;
        if (rightBuf < threshold && maxTo - cache.loadedTo > 1_000) {
          const edgeFrom = cache.loadedTo;
          const edgeTo = Math.min(edgeFrom + span * 1.5, maxTo);
          const requestedRes = (edgeTo - edgeFrom) / 1000 / effEdgePts;
          didFetch = true;
          setIsLoading(true);
          promise = promise.then(() => {
            if (ac.signal.aborted) return;
            return fetchRangeMulti(routerSn, equipType, panelId, curAddrs, edgeFrom, edgeTo, edgePts, ac.signal)
              .then((res) => {
                if (!res || ac.signal.aborted) return;
                cache.series = cache.series.map((pts, i) => mergePoints(pts, res.series[i] ?? []));
                cache.gaps = mergeGaps(cache.gaps, res.gaps);
                cache.loadedTo = edgeTo;
                cache.resolutionSecs = Math.max(cache.resolutionSecs, res.resolutionSecs);
                cache.requestedResSecs = Math.max(cache.requestedResSecs, requestedRes);
                trimCache(cache, viewportRef.current);
                setSeries(cache.series);
                setGaps(cache.gaps);
              });
          });
        }

        if (didFetch) {
          promise.then(() => { if (!ac.signal.aborted) setIsLoading(false); });
        }
      }
    }, FETCH_DEBOUNCE_MS);

    return () => clearTimeout(timerRef.current);

  }, [viewport, routerSn, equipType, panelId, addrsKey]);

  /* ── zoom к курсору ────────────────────────────────────────────────────── */
  const zoomAtCursor = useCallback((cursorTimeMs: number, zoomIn: boolean) => {
    setIsLive(false);
    setViewportRaw((prev) => {
      const span = prev.to - prev.from;
      const factor = zoomIn ? 1 - ZOOM_SPEED : 1 + ZOOM_SPEED;
      const fda = firstDataAtRef.current;
      const now = Date.now();

      // Максимальный span: от первой точки данных до now + буфер
      const maxSpan = fda != null
        ? (now + FUTURE_PAD_MS) - fda
        : span * 10; // если first_data_at не известен — не ограничиваем жёстко

      const newSpan = clamp(span * factor, MIN_SPAN_MS, maxSpan);

      // Пропорция курсора внутри viewport
      const ratio = clamp((cursorTimeMs - prev.from) / span, 0, 1);

      let newFrom = cursorTimeMs - ratio * newSpan;
      let newTo = newFrom + newSpan;

      // П.4: если зум назад упёрся в будущее — привязываем правый край
      if (newTo > now + FUTURE_PAD_MS) {
        newTo = now + FUTURE_PAD_MS;
        newFrom = newTo - newSpan;
      }

      // П.7: если отъехали дальше first_data_at — не уходим в пустоту
      if (fda != null && newFrom < fda - newSpan * 0.1) {
        newFrom = fda - newSpan * 0.1;
        newTo = newFrom + newSpan;
      }

      return { from: newFrom, to: newTo };
    });
  }, []);

  /* ── setViewport (от drag/pan в графике) ──────────────────────────────── */
  const setViewport = useCallback((vp: ViewportRange) => {
    if (!isFiniteNumber(vp.from) || !isFiniteNumber(vp.to) || vp.to <= vp.from) return;
    setIsLive(false);

    setViewportRaw((prev) => {
      // Пан НЕ меняет масштаб — сохраняем span предыдущего viewport.
      // Графическая библиотека может слегка менять span при пане,
      // что вызывает прыжки зума. Фиксируем span — меняется только позиция.
      const prevSpan = prev.to - prev.from;
      let newFrom = vp.from;
      let newTo = newFrom + prevSpan;

      // Ограничение пана в будущее: правый край не дальше now + FUTURE_PAD_MS
      const maxTo = Date.now() + FUTURE_PAD_MS;
      if (newTo > maxTo) {
        newTo = maxTo;
        newFrom = newTo - prevSpan;
      }

      // Ограничение пана в прошлое: не дальше firstDataAt - 30% видимой области.
      const fda = firstDataAtRef.current;
      if (fda != null) {
        const minFrom = fda - prevSpan * 0.3;
        if (newFrom < minFrom) {
          newFrom = minFrom;
          newTo = newFrom + prevSpan;
        }
      }

      return { from: newFrom, to: newTo };
    });
  }, []);

  /* ── refresh / reset ───────────────────────────────────────────────────── */
  const refresh = useCallback(() => {
    abortRef.current?.abort();
    cacheRef.current = null;
    pendingLiveRef.current = null;
    liveShiftSkipRef.current = false;
    setSeries(addrsRef.current.map(() => []));
    setGaps([]);
    setFirstDataAt(null);
    setIsLoading(true);
    setIsLive(true);
    setViewportRaw(makeDefaultViewport());
  }, []);

  /* ── Live: безопасный парсинг timestamp ──────────────────────────────── */
  function parseLiveTs(raw: string | null | undefined): number {
    if (!raw) return Date.now();
    // parseIsoToMs добавляет "Z" если нет — единообразно с history
    try {
      const ms = parseIsoToMs(raw);
      return isFiniteNumber(ms) ? ms : Date.now();
    } catch {
      return Date.now();
    }
  }

  /* ── Live: подписка на телеметрию из WS (императивная) ────────────────── */
  const liveAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isLive) return;

    const key = makeEquipKey(routerSn, equipType, Number(panelId));
    const lastTsByAddr = new Map<number, number>();

    const unsub = useTelemetryStore.subscribe((state) => {
      if (!isLiveRef.current) return;

      const regs = state.registers.get(key);
      if (!regs) return;

      const curAddrs = addrsRef.current;
      const newPts: (ChartPoint | null)[] = curAddrs.map((addr) => {
        const reg = regs.get(addr);
        if (!reg || reg.value == null) return null;
        const ts = parseLiveTs(reg.ts);
        if (ts <= (lastTsByAddr.get(addr) ?? 0)) return null;
        lastTsByAddr.set(addr, ts);
        return { ts, value: reg.value, sampleCount: 1 };
      });
      if (newPts.every((p) => p == null)) return;

      // Добавляем точки в кэш
      const cache = cacheRef.current;
      if (cache) {
        cache.series = cache.series.map((pts, i) =>
          newPts[i] ? mergePoints(pts, [newPts[i]!]) : pts,
        );
        const maxTs = Math.max(...newPts.filter(Boolean).map((p) => p!.ts));
        cache.loadedTo = Math.max(cache.loadedTo, maxTs + 1000);
      } else {
        // Первичная загрузка ещё идёт — буферизуем, data-loader вольёт
        // точки в кэш по её завершении (иначе они потеряются: lastTsByAddr
        // уже запомнил их ts и повторно из WS они не придут)
        const buf = pendingLiveRef.current ?? curAddrs.map(() => []);
        newPts.forEach((p, i) => {
          if (p) buf[i] = mergePoints(buf[i] ?? [], [p]);
        });
        pendingLiveRef.current = buf;
      }

      setSeries((prev) =>
        prev.map((pts, i) => (newPts[i] ? mergePoints(pts, [newPts[i]!]) : pts)),
      );
    });

    return unsub;
     
  }, [isLive, routerSn, equipType, panelId, addrsKey]);

  /* ── Live: авто-сдвиг viewport + свежий fetch каждую минуту ─────────── */
  useEffect(() => {
    if (!isLive) return;

    const timer = setInterval(() => {
      if (!isLiveRef.current) return;

      const now = Date.now();

      // 1. Сдвигаем viewport. Данные приносят WS-подписка и fetch ниже,
      //    поэтому обычную загрузку по смене viewport пропускаем (флаг).
      const newVp: ViewportRange = (() => {
        const prev = viewportRef.current;
        const span = prev.to - prev.from;
        const newTo = now + FUTURE_PAD_MS;
        return { from: newTo - span, to: newTo };
      })();

      // 2. Свежий fetch за последние 5 минут — страховка для точек,
      //    которые бэкенд уже сохранил в БД, но WS не доставил
      liveAbortRef.current?.abort();
      const ac = new AbortController();
      liveAbortRef.current = ac;

      const fetchFrom = now - 5 * 60_000;
      const fetchTo = now + FUTURE_PAD_MS;
      fetchRangeMulti(routerSn, equipType, panelId, addrsRef.current, fetchFrom, fetchTo, 500, ac.signal)
        .then((res) => {
          if (!res || ac.signal.aborted || !isLiveRef.current) return;
          // Кэш читаем после ответа — он мог появиться, пока шёл запрос
          const cache = cacheRef.current;
          if (cache) {
            cache.series = cache.series.map((pts, i) =>
              mergePoints(pts, res.series[i] ?? []),
            );
            // Фактически загружено до «сейчас» (момент запроса), не до pad
            cache.loadedTo = Math.max(cache.loadedTo, now);
            setSeries(cache.series);
          } else {
            setSeries(res.series);
          }
        });

      // 3. Обновляем viewport state (data-loader этот сдвиг пропустит)
      liveShiftSkipRef.current = true;
      setViewportRaw(newVp);
    }, LIVE_SHIFT_INTERVAL_MS);

    return () => {
      clearInterval(timer);
      liveAbortRef.current?.abort();
    };
     
  }, [isLive, routerSn, equipType, panelId, addrsKey]);

  return { viewport, series, gaps, isLoading, firstDataAt, isLive, zoomAtCursor, setViewport, refresh };
}
