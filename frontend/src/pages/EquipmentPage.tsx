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

import { useState, useMemo, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Wifi, WifiOff } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import InlineEdit from "@/components/ui/inline-edit";
import { useIsAdmin } from "@/hooks/use-auth";
import { useRegisters } from "@/hooks/use-registers";
import { useEquipment } from "@/hooks/use-equipment";
import { useRenameEquipment } from "@/hooks/use-rename";
import { useMachineAnalytics } from "@/hooks/use-analytics";
import { useTelemetryStore, makeEquipKey } from "@/stores/telemetry-store";
import { formatRelativeTime } from "@/lib/format";
import { CARD_ACCENT } from "@/components/equipment/panel/severityAccent";
import AnalyticsStrip from "@/components/equipment/AnalyticsStrip";
import AnalyticsCalendarDialog from "@/components/equipment/AnalyticsCalendarDialog";
import LedPanel from "@/components/equipment/panel/LedPanel";
import ModePlaque from "@/components/equipment/ModePlaque";
import LoadGauge from "@/components/equipment/panel/LoadGauge";
import PhaseBars from "@/components/equipment/panel/PhaseBars";
import DigitalWindow from "@/components/equipment/panel/DigitalWindow";
import { OilBox, IconValueBox } from "@/components/equipment/panel/ParamBoxes";
import { CoolantIcon, BatteryIcon } from "@/components/equipment/panel/PanelIcons";
import { useDguPanelValues } from "@/components/equipment/panel/useDguPanelValues";
import {
  REG,
  batteryState,
  coolantState,
  rpmState,
  formatHours,
} from "@/components/equipment/panel/registers";
import RegistersTab from "@/components/equipment/registers/RegistersTab";
import HistoryTab, { type ChartRequest } from "@/components/equipment/history/HistoryTab";
import JournalTab from "@/components/equipment/journal/JournalTab";
import NotificationsTab from "@/components/equipment/notifications/NotificationsTab";
import { ErrorBoundary } from "@/components/ui/error-boundary";

/** Кликабельная зона панели: переключает график на свой регистр */
function ChartLink({
  onOpen,
  title,
  className,
  children,
}: {
  onOpen: () => void;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      title={title}
      onClick={onOpen}
      className={`cursor-pointer transition-opacity hover:opacity-80 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

export default function EquipmentPage() {
  const { routerSn, equipType, panelId } = useParams<{
    routerSn: string;
    equipType: string;
    panelId: string;
  }>();

  const isAdmin = useIsAdmin();
  const key = makeEquipKey(routerSn!, equipType!, panelId!);
  const liveRegs = useTelemetryStore((s) => s.registers.get(key));
  const wsConnected = useTelemetryStore((s) => s.connected);

  // Имя оборудования
  const { data: eqList } = useEquipment(routerSn!);
  const eqInfo = eqList?.find(
    (e) => e.equip_type === equipType && String(e.panel_id) === panelId,
  );
  const displayName = eqInfo?.name || `${equipType} #${panelId}`;

  const renameMutation = useRenameEquipment(routerSn!, equipType!, panelId!);
  const handleRename = useCallback(
    async (name: string) => {
      await renameMutation.mutateAsync(name);
    },
    [renameMutation],
  );

  const { data: registers, isLoading: regsLoading } = useRegisters(
    routerSn!,
    equipType!,
    panelId!,
  );

  // Merge REST registers (metadata) with live WS data (value + raw only)
  const mergedRegisters = useMemo(() => {
    if (!registers) return [];
    return registers.map((r) => {
      const live = liveRegs?.get(r.addr);
      if (!live) return r;
      // Keep all HTTP metadata (name, text, unit, faults, …), only update numeric fields
      return { ...r, value: live.value, raw: live.raw, ts: live.ts, receivedAt: live.receivedAt };
    });
  }, [registers, liveRegs]);

  // ── Панель ДГУ (живые значения + REST-фолбек) ──────────────────────
  const v = useDguPanelValues(routerSn!, equipType!, panelId!, eqInfo);
  const rpmSt = rpmState(v.rpm, v.running);

  const analytics = useMachineAnalytics(routerSn!, equipType!, panelId!);
  const accent = analytics
    ? CARD_ACCENT[analytics.severity_level ?? "норма"] ?? CARD_ACCENT["норма"]
    : null;
  const [calendarOpen, setCalendarOpen] = useState(false);

  // ── Панель управляет графиком ──────────────────────────────────────
  const [tab, setTab] = useState("history");
  const [chartReq, setChartReq] = useState<ChartRequest | null>(null);
  const openChart = useCallback((target: string) => {
    setChartReq((prev) => ({ target, seq: (prev?.seq ?? 0) + 1 }));
    setTab("history");
  }, []);

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        to={`/objects/${routerSn}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Назад к объекту
      </Link>

      {/* Hero: горизонтальная панель управления ДВС */}
      <Card
        className={`relative gap-0 overflow-hidden border pt-5 pb-4 ${accent?.card ?? ""}`}
      >
        {accent && (
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent ${accent.bar} to-transparent`}
          />
        )}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-4 px-6">
          {/* Идентичность + лампы */}
          <div className="min-w-44">
            <div className="text-lg font-semibold">
              {isAdmin ? (
                <InlineEdit
                  value={displayName}
                  placeholder={`${equipType} #${panelId}`}
                  onSave={handleRename}
                  inputClassName="text-lg font-semibold w-52"
                />
              ) : (
                displayName
              )}
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">
              {routerSn}
            </p>
            <div className="mt-1 flex items-center gap-2">
              {v.panelFresh ? (
                <span className="flex items-center gap-1 text-[11px] text-green-500">
                  <Wifi className="h-3 w-3" />
                  на связи
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] text-red-400">
                  <WifiOff className="h-3 w-3" />
                  нет данных
                </span>
              )}
              {v.lastUpdate && (
                <span className="text-[11px] text-muted-foreground">
                  · {formatRelativeTime(new Date(v.lastUpdate))}
                </span>
              )}
            </div>
            <div className="mt-2 flex w-fit flex-col items-stretch gap-1.5">
              <LedPanel
                modeRaw={v.modeRaw}
                stateRaw={v.stateRaw}
                faultRaw={v.faultRaw}
              />
              <ModePlaque analytics={analytics} />
            </div>
          </div>

          {/* Шкала нагрузки */}
          <ChartLink onOpen={() => openChart(`a:${REG.LOAD_KW}`)} title="График нагрузки">
            <LoadGauge loadKw={v.loadKw} ratedKw={v.ratedKw} width={150} />
          </ChartLink>

          {/* Параметры двигателя */}
          <div className="flex w-60 flex-col gap-2">
            <ChartLink
              onOpen={() => openChart("c:oil")}
              title="График масла: давление + температура"
            >
              <OilBox pressKpa={v.oilPress} tempC={v.oilTemp} running={v.running} />
            </ChartLink>
            <div className="flex gap-2">
              <ChartLink
                onOpen={() => openChart(`a:${REG.COOLANT_TEMP}`)}
                title="График температуры ОЖ"
                className="flex flex-1"
              >
                <IconValueBox
                  icon={<CoolantIcon className="h-5 w-5" />}
                  value={v.coolant}
                  unit="°C"
                  state={coolantState(v.coolant, v.running)}
                />
              </ChartLink>
              <ChartLink
                onOpen={() => openChart(`a:${REG.BATTERY_V}`)}
                title="График напряжения АКБ"
                className="flex flex-1"
              >
                <IconValueBox
                  icon={<BatteryIcon className="h-5 w-5" />}
                  value={v.battery}
                  unit="В"
                  decimals={1}
                  state={batteryState(v.battery)}
                />
              </ChartLink>
            </div>
          </div>

          {/* Токи фаз */}
          <ChartLink
            onOpen={() => openChart("c:phases")}
            title="График токов фаз A·B·C"
            className="flex h-28 w-44"
          >
            <PhaseBars currents={v.currents} nominalA={v.nominalA} />
          </ChartLink>

          {/* Цифровые окошки */}
          <div className="flex w-52 flex-col gap-2">
            <ChartLink
              onOpen={() => openChart(`a:${REG.VOLTAGE_LL}`)}
              title="График напряжения"
            >
              <DigitalWindow
                label="НАПРЯЖЕНИЕ"
                value={v.voltage != null ? String(Math.round(v.voltage)) : "—"}
                unit="В"
                tone={
                  v.running && v.voltage != null && v.voltage > 100
                    ? "active"
                    : "idle"
                }
              />
            </ChartLink>
            <ChartLink
              onOpen={() => openChart(`a:${REG.ENGINE_HOURS}`)}
              title="График наработки"
            >
              <DigitalWindow
                label="МОТОЧАСЫ"
                value={formatHours(v.hours)}
                tone={v.hours != null ? "active" : "idle"}
                wide
              />
            </ChartLink>
            <ChartLink
              onOpen={() => openChart(`a:${REG.RPM}`)}
              title="График оборотов"
            >
              <DigitalWindow
                label="ОБОРОТЫ"
                value={v.rpm != null ? String(Math.round(v.rpm)) : "—"}
                tone={rpmSt === "crit" ? "crit" : rpmSt === "idle" ? "idle" : "active"}
              />
            </ChartLink>
          </div>
        </div>

        {analytics && (
          <AnalyticsStrip
            analytics={analytics}
            compact
            onOpenCalendar={() => setCalendarOpen(true)}
          />
        )}
      </Card>
      {analytics && (
        <AnalyticsCalendarDialog
          open={calendarOpen}
          onOpenChange={setCalendarOpen}
          machine={analytics}
          displayName={displayName}
        />
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="history">График</TabsTrigger>
          <TabsTrigger value="registers">Регистры</TabsTrigger>
          <TabsTrigger value="journal">Журнал</TabsTrigger>
          <TabsTrigger value="notifications">Уведомления</TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="mt-4">
          <ErrorBoundary>
            <HistoryTab
              routerSn={routerSn!}
              equipType={equipType!}
              panelId={panelId!}
              chartRequest={chartReq}
            />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="registers" className="mt-4">
          <ErrorBoundary>
            <RegistersTab
              registers={mergedRegisters}
              isLoading={regsLoading}
              liveCount={liveRegs?.size ?? 0}
              wsConnected={wsConnected}
              lastWsUpdate={v.lastUpdate}
            />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="journal" className="mt-4">
          <ErrorBoundary>
            <JournalTab
              routerSn={routerSn!}
              equipType={equipType!}
              panelId={panelId!}
            />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="notifications" className="mt-4">
          <ErrorBoundary>
            <NotificationsTab
              routerSn={routerSn!}
              equipType={equipType!}
              panelId={panelId!}
            />
          </ErrorBoundary>
        </TabsContent>
      </Tabs>
    </div>
  );
}
