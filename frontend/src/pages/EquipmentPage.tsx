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
import { StatBox, StatBar } from "@/components/equipment/panel/ParamBoxes";
import {
  MeterIcon,
  OilCanIcon,
  OilTempIcon,
  FanIcon,
  BatteryIcon,
} from "@/components/equipment/panel/PanelIcons";
import { Gauge, Activity } from "lucide-react";
import { useDguPanelValues } from "@/components/equipment/panel/useDguPanelValues";
import {
  REG,
  batteryState,
  coolantState,
  rpmState,
  voltageState,
  frequencyState,
  oilPressState,
  oilTempState,
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

  const analyticsRaw = useMachineAnalytics(routerSn!, equipType!, panelId!);
  // Панель offline или телеметрия аналитики устарела (data_stale) → блок ИИ
  // скрываем целиком: «норма от ИИ» без данных подрывает доверие
  const analytics =
    analyticsRaw && v.panelFresh && !analyticsRaw.data_stale ? analyticsRaw : undefined;
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

          {/* Двигатель: масло (давление · температура) + ОЖ / АКБ */}
          <div className="flex w-60 flex-col gap-2">
            <div className="flex gap-2">
              <ChartLink
                onOpen={() => openChart("c:oil")}
                title="График давления масла"
                className="flex flex-1"
              >
                <StatBox
                  icon={<OilCanIcon className="h-[22px] w-[22px]" />}
                  value={v.oilPress}
                  unit="кПа"
                  state={oilPressState(v.oilPress, v.running)}
                />
              </ChartLink>
              <ChartLink
                onOpen={() => openChart("c:oil")}
                title="График температуры масла"
                className="flex flex-1"
              >
                <StatBox
                  icon={<OilTempIcon className="h-[22px] w-[22px]" />}
                  value={v.oilTemp}
                  unit="°C"
                  state={oilTempState(v.oilTemp, v.running)}
                />
              </ChartLink>
            </div>
            <div className="flex gap-2">
              <ChartLink
                onOpen={() => openChart(`a:${REG.COOLANT_TEMP}`)}
                title="График температуры ОЖ"
                className="flex flex-1"
              >
                <StatBox
                  icon={<FanIcon className="h-5 w-5" />}
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
                <StatBox
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

          {/* Электрика: напряжение · частота · обороты + моточасы */}
          <div className="flex w-52 flex-col gap-2">
            <div className="flex gap-2">
              <ChartLink
                onOpen={() => openChart(`a:${REG.VOLTAGE_LL}`)}
                title="График напряжения"
                className="flex flex-1"
              >
                <StatBox
                  icon={<MeterIcon className="h-5 w-5" />}
                  value={v.voltage}
                  unit="В"
                  state={voltageState(v.voltage, v.running)}
                />
              </ChartLink>
              <ChartLink
                onOpen={() => openChart(`a:${REG.FREQUENCY}`)}
                title="График частоты"
                className="flex flex-1"
              >
                <StatBox
                  icon={<Activity className="h-5 w-5" />}
                  value={v.frequency}
                  unit="Гц"
                  decimals={1}
                  state={frequencyState(v.frequency, v.running)}
                />
              </ChartLink>
            </div>
            <div className="flex gap-2">
              <ChartLink
                onOpen={() => openChart(`a:${REG.RPM}`)}
                title="График оборотов"
                className="flex flex-1"
              >
                <StatBox
                  icon={<Gauge className="h-5 w-5" />}
                  value={v.rpm}
                  unit="об/м"
                  state={rpmState(v.rpm, v.running)}
                />
              </ChartLink>
            </div>
            <ChartLink
              onOpen={() => openChart(`a:${REG.ENGINE_HOURS}`)}
              title="График наработки"
            >
              <StatBar
                label="МОТОЧАСЫ"
                value={formatHours(v.hours)}
                state={v.hours != null ? "ok" : "idle"}
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
