import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useHistory } from "@/hooks/use-history";
import { useTelemetryStore, makeEquipKey } from "@/stores/telemetry-store";
import { useSettingsStore } from "@/stores/settings-store";
import { HistoryChart } from "@/components/equipment/HistoryChart";
import {
  FUTURE_BUFFER_MS,
  RANGE_MS,
  REGISTER_OPTIONS,
  SILENT_SYNC_MS,
} from "./constants";
import { interpolateToGrid, mergeChartData, spanToRange } from "./utils";
import type { ChartPoint, HistoryRangeKey } from "./types";

interface EquipmentHistoryPanelProps {
  routerSn: string;
  equipType: string;
  panelId: string;
}

export default function EquipmentHistoryPanel({
  routerSn,
  equipType,
  panelId,
}: EquipmentHistoryPanelProps) {
  const minGapPoints = useSettingsStore((s) => s.minGapPoints);
  const equipKey = makeEquipKey(routerSn, equipType, panelId);
  const liveRegs = useTelemetryStore((s) => s.registers.get(equipKey));

  const [selectedAddr, setSelectedAddr] = useState(40034);
  const [range, setRange] = useState<HistoryRangeKey>("24h");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [accumulatedData, setAccumulatedData] = useState<ChartPoint[]>([]);
  const [rawTimestamps, setRawTimestamps] = useState<Set<number>>(new Set());
  const [rangeKey, setRangeKey] = useState(0);
  const [zoomOverride, setZoomOverride] = useState<{
    spanMs: number;
    centerMs: number;
  } | null>(null);

  const zoomOverrideRef = useRef<{ spanMs: number; centerMs: number } | null>(null);
  const rangeRef = useRef<HistoryRangeKey>(range);
  const levelChangedRef = useRef(false);

  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  useEffect(() => {
    zoomOverrideRef.current = zoomOverride;
  }, [zoomOverride]);

  useEffect(() => {
    if (zoomOverride) return;
    const id = setInterval(() => setNowMs(Date.now()), SILENT_SYNC_MS);
    return () => clearInterval(id);
  }, [zoomOverride]);

  const handleRangeChange = useCallback((nextRange: HistoryRangeKey) => {
    setNowMs(Date.now());
    setRange(nextRange);
    setZoomOverride(null);
    setAccumulatedData([]);
    setRangeKey((k) => k + 1);
  }, []);

  const handleNeedData = useCallback((visibleSpanMs: number, centerMs: number) => {
    const now = Date.now();
    setNowMs(now);
    const currentRange = rangeRef.current;
    const nextRange = spanToRange(visibleSpanMs, currentRange);
    const halfRange = RANGE_MS[nextRange] / 2;
    const clampedCenter = Math.min(centerMs, now - halfRange);
    if (nextRange !== currentRange) {
      levelChangedRef.current = true;
    }
    setZoomOverride({ spanMs: RANGE_MS[nextRange], centerMs: clampedCenter });
    setRange(nextRange);
  }, []);

  const FETCH_MULTIPLIER_MAP: Record<HistoryRangeKey, number> = {
    "1h": 3,
    "24h": 4,
    "7d": 3,
    "30d": 2,
  };
  const fetchMultiplier = FETCH_MULTIPLIER_MAP[range] ?? 4;

  const { queryStart, queryEnd } = useMemo(() => {
    if (zoomOverride) {
      const fetchSpan = zoomOverride.spanMs * fetchMultiplier;
      const rightEdge = Math.min(zoomOverride.centerMs + zoomOverride.spanMs / 2, nowMs);
      const start = rightEdge - fetchSpan;
      return {
        queryStart: new Date(start).toISOString(),
        queryEnd: new Date(rightEdge).toISOString(),
      };
    }

    const rangeMs = RANGE_MS[range] ?? RANGE_MS["24h"];
    return {
      queryStart: new Date(nowMs - rangeMs * fetchMultiplier).toISOString(),
      queryEnd: new Date(nowMs).toISOString(),
    };
  }, [fetchMultiplier, nowMs, range, zoomOverride]);

  const targetPoints = useMemo(
    () => Math.min(20000, Math.max(2000, window.innerWidth * 4)),
    [],
  );

  const { data: historyResp, isLoading } = useHistory(
    routerSn,
    equipType,
    panelId,
    selectedAddr,
    queryStart,
    queryEnd,
    targetPoints,
    true,
    minGapPoints,
  );

  const rawChartData = useMemo<ChartPoint[]>(
    () =>
      (historyResp?.points ?? [])
        .filter((p) => p.ts != null && p.value != null)
        .map((p) => ({
          ts: new Date(p.ts!.endsWith("Z") ? p.ts! : p.ts! + "Z").getTime(),
          value: p.value as number,
          min_value: p.min_value ?? null,
          max_value: p.max_value ?? null,
        })),
    [historyResp],
  );

  const firstDataAt = useMemo(() => {
    const raw = historyResp?.first_data_at;
    if (!raw) return null;
    const s = raw.endsWith("Z") ? raw : raw + "Z";
    return new Date(s).getTime();
  }, [historyResp?.first_data_at]);

  const chartGaps = useMemo(
    () =>
      (historyResp?.gaps ?? []).map((g) => ({
        fromMs: new Date(g.from_ts.endsWith("Z") ? g.from_ts : g.from_ts + "Z").getTime(),
        toMs: new Date(g.to_ts.endsWith("Z") ? g.to_ts : g.to_ts + "Z").getTime(),
      })),
    [historyResp?.gaps],
  );

  useEffect(() => {
    if (rawChartData.length === 0) return;
    const { interpolated, rawTimestamps: nextRawTs } = interpolateToGrid(rawChartData, chartGaps);
    const shouldMerge = zoomOverrideRef.current && !levelChangedRef.current;
    const frame = requestAnimationFrame(() => {
      if (shouldMerge) {
        setRawTimestamps((prev) => {
          const merged = new Set(prev);
          for (const ts of nextRawTs) merged.add(ts);
          return merged;
        });
        setAccumulatedData((prev) => mergeChartData(prev, interpolated));
      } else {
        levelChangedRef.current = false;
        setRawTimestamps(nextRawTs);
        setAccumulatedData(interpolated);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [chartGaps, rawChartData]);

  const pendingRange = useMemo(() => {
    const rangeMs = RANGE_MS[range] ?? RANGE_MS["24h"];
    const futureBuffer = FUTURE_BUFFER_MS[range] ?? 2 * 3_600_000;
    return { from: nowMs - rangeMs, to: nowMs + futureBuffer, key: rangeKey };
  }, [nowMs, range, rangeKey]);

  const selectedReg = REGISTER_OPTIONS.find((r) => r.addr === selectedAddr);

  const livePoint = useMemo<ChartPoint | null>(() => {
    const reg = liveRegs?.get(selectedAddr);
    if (!reg || reg.value == null) return null;
    if (reg.raw === 65535 || reg.raw === 32767) return null;
    if (reg.reason?.toUpperCase().includes("NA")) return null;
    const tsStr = reg.ts ?? reg.receivedAt;
    const ts = new Date(tsStr.endsWith("Z") ? tsStr : tsStr + "Z").getTime();
    return { ts, value: reg.value };
  }, [liveRegs, selectedAddr]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={selectedAddr}
          onChange={(e) => setSelectedAddr(Number(e.target.value))}
          className="rounded-md border bg-card px-3 py-1.5 text-sm"
        >
          {REGISTER_OPTIONS.map((opt) => (
            <option key={opt.addr} value={opt.addr}>
              {opt.label}
            </option>
          ))}
        </select>

        <div className="flex gap-1">
          {(Object.keys(RANGE_MS) as HistoryRangeKey[]).map((rangeKeyItem) => (
            <button
              key={rangeKeyItem}
              onClick={() => handleRangeChange(rangeKeyItem)}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                range === rangeKeyItem && !zoomOverride
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {rangeKeyItem}
            </button>
          ))}
        </div>

        <span className="flex items-center gap-1.5 text-xs text-emerald-500">
          <span
            className={`h-2 w-2 rounded-full ${
              zoomOverride ? "bg-gray-400" : "bg-emerald-500 animate-pulse"
            }`}
          />
          {zoomOverride ? "Zoom" : "Live"}
        </span>
      </div>

      {isLoading && accumulatedData.length === 0 ? (
        <Skeleton className="h-[380px] w-full rounded-xl" />
      ) : accumulatedData.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Нет данных за выбранный период
          </CardContent>
        </Card>
      ) : (
        <HistoryChart
          data={accumulatedData}
          label={selectedReg?.label}
          color={selectedReg?.color ?? "#22c55e"}
          isLoading={isLoading}
          onNeedData={handleNeedData}
          pendingRange={zoomOverride ? null : pendingRange}
          firstDataAt={firstDataAt}
          gaps={chartGaps}
          rawTimestamps={rawTimestamps}
          livePoint={livePoint}
        />
      )}
    </div>
  );
}
