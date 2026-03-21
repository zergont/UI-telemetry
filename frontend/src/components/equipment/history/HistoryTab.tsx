import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSettingsStore } from "@/stores/settings-store";
import { useChartEngine } from "@/hooks/use-chart-engine";
import { HistoryChart } from "./HistoryChart";
import { MIN_SPAN_MS, REGISTER_OPTIONS } from "./constants";

interface HistoryTabProps {
  routerSn: string;
  equipType: string;
  panelId: string;
}

export default function HistoryTab({ routerSn, equipType, panelId }: HistoryTabProps) {
  const tzOffsetHours = useSettingsStore((s) => s.tzOffsetHours);
  const [selectedAddr, setSelectedAddr] = useState<number>(REGISTER_OPTIONS[0].addr);
  const selectedReg = REGISTER_OPTIONS.find((r) => r.addr === selectedAddr)!;

  const engine = useChartEngine({
    routerSn,
    equipType,
    panelId,
    addr: selectedAddr,
  });

  const hasData = engine.data.some((p) => p.value !== null);

  // Уровень зума: 0 = максимальное приближение (MIN_SPAN_MS), +1 за каждый шаг отдаления
  const span = engine.viewport.to - engine.viewport.from;
  const zoomLevel = Math.max(0, Math.round(Math.log(span / MIN_SPAN_MS) / Math.log(1.25)));

  return (
    <div className="space-y-4">
      {/* Панель управления */}
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

        <button
          onClick={engine.refresh}
          className="inline-flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${engine.isLoading ? "animate-spin" : ""}`} />
          Обновить
        </button>

        <span className="ml-auto text-xs text-muted-foreground/50 tabular-nums">
          z{zoomLevel}
        </span>
      </div>

      {/* График */}
      {engine.isLoading && !hasData ? (
        <Skeleton className="h-[400px] w-full rounded-xl" />
      ) : !hasData && !engine.isLoading ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Нет данных за выбранный период
          </CardContent>
        </Card>
      ) : (
        <HistoryChart
          data={engine.data}
          label={selectedReg.label}
          unit={selectedReg.unit}
          color={selectedReg.color}
          viewport={engine.viewport}
          isLoading={engine.isLoading}
          tzOffsetHours={tzOffsetHours}
          onZoom={engine.zoomAtCursor}
          onPan={engine.setViewport}
        />
      )}
    </div>
  );
}
