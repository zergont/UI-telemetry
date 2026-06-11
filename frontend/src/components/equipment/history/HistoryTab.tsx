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
import { Minus, Plus, RefreshCw, Radio } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSettingsStore } from "@/stores/settings-store";
import { useChartEngine } from "@/hooks/use-chart-engine";
import { useChartSettings, DEFAULT_REGISTERS } from "@/hooks/use-chart-settings";
import { HistoryChart, type ChartSeriesInput } from "./HistoryChart";
import { MIN_SPAN_MS } from "./constants";

/**
 * Запрос параметра извне (клик по панели ДГУ); seq — для повторных кликов.
 * target: "a:40034" (одиночный регистр) или "c:phases" / "c:oil" (композит).
 */
export interface ChartRequest {
  target: string;
  seq: number;
}

interface SeriesDef {
  addr: number;
  label: string;
  unit: string;
  color: string;
}

/** Композитные графики: несколько регистров на одном полотне */
const COMPOSITES: Record<string, { label: string; series: SeriesDef[] }> = {
  phases: {
    label: "Токи фаз A·B·C",
    series: [
      { addr: 40026, label: "Фаза A", unit: "А", color: "#3b82f6" },
      { addr: 40027, label: "Фаза B", unit: "А", color: "#10b981" },
      { addr: 40028, label: "Фаза C", unit: "А", color: "#f59e0b" },
    ],
  },
  oil: {
    label: "Масло: давление + температура",
    series: [
      { addr: 40062, label: "P масла", unit: "кПа", color: "#8b5cf6" },
      { addr: 40063, label: "t масла", unit: "°C", color: "#ef4444" },
    ],
  },
};

/** Метаданные регистров панели ДГУ, которых может не быть в настройках графика */
const PANEL_CHART_META: Record<number, Omit<SeriesDef, "addr">> = {
  40025: { label: "Напряжение (LL)", unit: "В", color: "#f59e0b" },
  40026: { label: "Ток фаза A", unit: "А", color: "#3b82f6" },
  40061: { label: "АКБ", unit: "В", color: "#a855f7" },
  40064: { label: "t ОЖ", unit: "°C", color: "#38bdf8" },
  40068: { label: "Обороты", unit: "об/мин", color: "#f97316" },
};

interface HistoryTabProps {
  routerSn: string;
  equipType: string;
  panelId: string;
  chartRequest?: ChartRequest | null;
}

export default function HistoryTab({ routerSn, equipType, panelId, chartRequest }: HistoryTabProps) {
  const tzOffsetHours = useSettingsStore((s) => s.tzOffsetHours);
  const { data: registerOptions = DEFAULT_REGISTERS } = useChartSettings();
  const [selected, setSelected] = useState<string>(
    `a:${registerOptions[0]?.addr ?? DEFAULT_REGISTERS[0].addr}`,
  );

  // Клик по элементу панели ДГУ переключает график
  // (подстройка состояния во время рендера — без эффекта)
  const [appliedSeq, setAppliedSeq] = useState(0);
  if (chartRequest && chartRequest.seq !== appliedSeq) {
    setAppliedSeq(chartRequest.seq);
    setSelected(chartRequest.target);
  }

  // ── Выбор → набор серий ────────────────────────────────────────────────
  const seriesDefs = useMemo<SeriesDef[]>(() => {
    if (selected.startsWith("c:")) {
      const comp = COMPOSITES[selected.slice(2)];
      if (comp) return comp.series;
    }
    const addr = Number(selected.slice(2)) || registerOptions[0]?.addr || DEFAULT_REGISTERS[0].addr;
    const fromSettings = registerOptions.find((r) => r.addr === addr);
    if (fromSettings) return [fromSettings];
    const meta = PANEL_CHART_META[addr];
    if (meta) return [{ addr, ...meta }];
    return [registerOptions[0] ?? DEFAULT_REGISTERS[0]];
  }, [selected, registerOptions]);

  const addrs = useMemo(() => seriesDefs.map((d) => d.addr), [seriesDefs]);

  // Опции селектора: настроенные + композиты + временный регистр панели
  const selectedAddr = selected.startsWith("a:") ? Number(selected.slice(2)) : null;
  const extraOption =
    selectedAddr != null &&
    !registerOptions.some((r) => r.addr === selectedAddr) &&
    PANEL_CHART_META[selectedAddr]
      ? { addr: selectedAddr, ...PANEL_CHART_META[selectedAddr] }
      : null;

  const engine = useChartEngine({
    routerSn,
    equipType,
    panelId,
    addrs,
  });

  const chartSeries = useMemo<ChartSeriesInput[]>(
    () =>
      seriesDefs.map((d, i) => ({
        label: d.label,
        unit: d.unit,
        color: d.color,
        points: engine.series[i] ?? [],
      })),
    [seriesDefs, engine.series],
  );

  const hasData = engine.series.some((pts) => pts.some((p) => p.value !== null));

  // Уровень зума: 0 = максимальное приближение (MIN_SPAN_MS), +1 за каждый шаг отдаления
  const span = engine.viewport.to - engine.viewport.from;
  const zoomLevel = Math.max(0, Math.round(Math.log(span / MIN_SPAN_MS) / Math.log(1.25)));

  // Тип данных: raw (history) при span ≤ 30 дней, иначе агрегированные
  const spanSec = span / 1000;
  const dataSource = spanSec <= 30 * 86400
    ? "raw"
    : spanSec <= 90 * 86400
      ? "1min"
      : "1hour";

  // Zoom +/- через центр viewport
  const handleZoomBtn = (zoomIn: boolean) => {
    const center = (engine.viewport.from + engine.viewport.to) / 2;
    engine.zoomAtCursor(center, zoomIn);
  };

  return (
    <div className="space-y-4">
      {/* Панель управления */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded-md border bg-card px-3 py-1.5 text-sm"
        >
          {registerOptions.map((opt) => (
            <option key={opt.addr} value={`a:${opt.addr}`}>
              {opt.label}
            </option>
          ))}
          {extraOption && (
            <option value={`a:${extraOption.addr}`}>{extraOption.label}</option>
          )}
          {Object.entries(COMPOSITES).map(([id, comp]) => (
            <option key={id} value={`c:${id}`}>
              {comp.label}
            </option>
          ))}
        </select>

        {engine.isLive ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-green-500/10 px-3 py-1.5 text-sm text-green-600 dark:text-green-400">
            <Radio className="h-3.5 w-3.5 animate-pulse" />
            Онлайн мониторинг
          </span>
        ) : (
          <button
            onClick={engine.refresh}
            className="inline-flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${engine.isLoading ? "animate-spin" : ""}`} />
            Обновить
          </button>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground/50">
            {dataSource === "raw" ? "raw" : dataSource}
          </span>
          <button
            onClick={() => handleZoomBtn(true)}
            className="inline-flex h-6 w-6 items-center justify-center rounded border bg-card text-xs text-muted-foreground hover:bg-muted"
            title="Приблизить"
          >
            <Plus className="h-3 w-3" />
          </button>
          <span className="text-xs text-muted-foreground/50 tabular-nums w-6 text-center">
            z{zoomLevel}
          </span>
          <button
            onClick={() => handleZoomBtn(false)}
            className="inline-flex h-6 w-6 items-center justify-center rounded border bg-card text-xs text-muted-foreground hover:bg-muted"
            title="Отдалить"
          >
            <Minus className="h-3 w-3" />
          </button>
        </div>
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
          series={chartSeries}
          gaps={engine.gaps}
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
