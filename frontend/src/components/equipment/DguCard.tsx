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

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Wifi, WifiOff, Gauge, Activity } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { EquipmentOut } from "@/hooks/use-equipment";
import { useMachineAnalytics } from "@/hooks/use-analytics";
import { formatRelativeTime } from "@/lib/format";
import { CARD_ACCENT } from "./panel/severityAccent";
import AnalyticsStrip from "./AnalyticsStrip";
import AnalyticsCalendarDialog from "./AnalyticsCalendarDialog";
import LedPanel from "./panel/LedPanel";
import ModePlaque from "./ModePlaque";
import LoadGauge from "./panel/LoadGauge";
import PhaseBars from "./panel/PhaseBars";
import { StatBox, StatBar } from "./panel/ParamBoxes";
import {
  MeterIcon,
  OilCanIcon,
  OilTempIcon,
  FanIcon,
  BatteryIcon,
} from "./panel/PanelIcons";
import { useDguPanelValues } from "./panel/useDguPanelValues";
import {
  batteryState,
  coolantState,
  rpmState,
  voltageState,
  frequencyState,
  oilPressState,
  oilTempState,
  loadZoneColor,
  formatHours,
} from "./panel/registers";

export type DguCardVariant = "minimal" | "normal" | "extended";

/** Тонкая полоса нагрузки с зонными рисками (вариант «минимал») */
function MiniLoadBar({ pct }: { pct: number | null }) {
  const frac = pct != null ? Math.min(pct, 100) : 0;
  const color = pct != null ? loadZoneColor(pct) : "#10b981";
  return (
    <div className="relative h-2 flex-1 rounded-full bg-muted dark:bg-white/10">
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: `${frac}%`,
          background: color,
          transition: "width 0.6s ease, background 0.6s ease",
        }}
      />
      {(
        [
          [30, "#eab308"],
          [80, "#f59e0b"],
          [90, "#ef4444"],
        ] as const
      ).map(([at, tick]) => (
        <span
          key={at}
          className="absolute -bottom-0.5 -top-0.5 w-[1.5px]"
          style={{ left: `${at}%`, background: tick }}
        />
      ))}
    </div>
  );
}

interface Props {
  equipment: EquipmentOut;
  variant?: DguCardVariant;
}

export default function DguCard({ equipment: eq, variant = "normal" }: Props) {
  const navigate = useNavigate();

  const {
    panelFresh,
    lastUpdate,
    modeRaw,
    stateRaw,
    faultRaw,
    running,
    loadKw,
    ratedKw,
    loadPct,
    oilPress,
    oilTemp,
    coolant,
    battery,
    rpm,
    voltage,
    frequency,
    currents,
    nominalA,
    hours,
  } = useDguPanelValues(eq.router_sn, eq.equip_type, eq.panel_id, eq);

  // ИИ-аналитика из cg-analytics (undefined — сервис недоступен или машина не наблюдается)
  const analytics = useMachineAnalytics(eq.router_sn, eq.equip_type, eq.panel_id);
  const accent = analytics
    ? CARD_ACCENT[analytics.severity_level ?? "норма"] ?? CARD_ACCENT["норма"]
    : null;
  const [calendarOpen, setCalendarOpen] = useState(false);

  const displayName = eq.name || `${eq.equip_type} #${eq.panel_id}`;

  // ── Общие блоки ────────────────────────────────────────────────────
  const header = (
    <div className="flex items-start justify-between px-6">
      <div>
        <h3
          className={`font-semibold ${variant === "minimal" ? "text-sm" : "text-base"}`}
        >
          {displayName}
        </h3>
        <div className="mt-0.5 flex items-center gap-2">
          {panelFresh ? (
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
          {lastUpdate && (
            <span className="text-[11px] text-muted-foreground">
              · {formatRelativeTime(new Date(lastUpdate))}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-stretch gap-1.5">
        <LedPanel
          modeRaw={modeRaw}
          stateRaw={stateRaw}
          faultRaw={faultRaw}
          size={variant === "minimal" ? "sm" : "md"}
        />
        <ModePlaque
          analytics={analytics}
          size={variant === "minimal" ? "sm" : "md"}
        />
      </div>
    </div>
  );

  const oilPressBox = (
    <StatBox
      icon={<OilCanIcon className="h-[22px] w-[22px]" />}
      value={oilPress}
      unit="кПа"
      state={oilPressState(oilPress, running)}
    />
  );
  const oilTempBox = (
    <StatBox
      icon={<OilTempIcon className="h-[22px] w-[22px]" />}
      value={oilTemp}
      unit="°C"
      state={oilTempState(oilTemp, running)}
    />
  );
  const coolantBox = (
    <StatBox
      icon={<FanIcon className="h-5 w-5" />}
      value={coolant}
      unit="°C"
      state={coolantState(coolant, running)}
    />
  );
  const batteryBox = (
    <StatBox
      icon={<BatteryIcon className="h-5 w-5" />}
      value={battery}
      unit="В"
      decimals={1}
      state={batteryState(battery)}
    />
  );
  const voltageBox = (
    <StatBox
      icon={<MeterIcon className="h-5 w-5" />}
      value={voltage}
      unit="В"
      state={voltageState(voltage, running)}
    />
  );
  const freqBox = (
    <StatBox
      icon={<Activity className="h-5 w-5" />}
      value={frequency}
      unit="Гц"
      decimals={1}
      state={frequencyState(frequency, running)}
    />
  );
  const rpmBox = (
    <StatBox
      icon={<Gauge className="h-5 w-5" />}
      value={rpm}
      unit="об/м"
      state={rpmState(rpm, running)}
    />
  );
  const motoBar = (
    <StatBar
      label="МОТОЧАСЫ"
      value={formatHours(hours)}
      state={hours != null ? "ok" : "idle"}
    />
  );

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
      <Card
        className={`relative cursor-pointer gap-0 overflow-hidden border transition-all duration-300 hover:shadow-lg ${
          variant === "minimal" ? "py-4" : "py-5"
        } ${accent?.card ?? "hover:border-foreground/15"}`}
        onClick={() =>
          navigate(
            `/objects/${eq.router_sn}/equipment/${eq.equip_type}/${eq.panel_id}`,
          )
        }
      >
        {/* Акцентная линия severity по верхней кромке */}
        {accent && (
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent ${accent.bar} to-transparent`}
          />
        )}

        {header}

        {variant === "minimal" ? (
          <div className="mt-2.5 flex items-center gap-3 px-6">
            <MiniLoadBar pct={loadPct} />
            <span className="whitespace-nowrap font-mono text-[13px] tabular-nums text-foreground/90">
              {loadKw != null ? Math.round(loadKw) : "—"} кВт
              {loadPct != null && (
                <span className="text-muted-foreground"> · {Math.round(loadPct)}%</span>
              )}
            </span>
          </div>
        ) : (
          <div className="mt-3.5 flex items-center gap-3.5 px-6">
            <LoadGauge
              loadKw={loadKw}
              ratedKw={ratedKw}
              width={variant === "extended" ? 180 : 152}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {/* Единые короткие плашки парами + длинная для моточасов */}
              <div className="flex gap-2">
                {oilPressBox}
                {oilTempBox}
              </div>
              <div className="flex gap-2">
                {coolantBox}
                {variant === "extended" ? batteryBox : rpmBox}
              </div>
              {motoBar}
            </div>
          </div>
        )}

        {variant === "extended" && (
          <div className="mt-2 flex items-stretch gap-2.5 px-6">
            <div className="flex min-w-0 flex-[1.2]">
              <PhaseBars currents={currents} nominalA={nominalA} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
              {voltageBox}
              {freqBox}
              {rpmBox}
            </div>
          </div>
        )}

        {analytics && (
          <AnalyticsStrip
            analytics={analytics}
            compact={variant === "minimal"}
            onOpenCalendar={() => setCalendarOpen(true)}
          />
        )}
      </Card>
      {/* Диалог вне Card: клики из портала не должны всплывать в onClick карточки */}
      {analytics && (
        <AnalyticsCalendarDialog
          open={calendarOpen}
          onOpenChange={setCalendarOpen}
          machine={analytics}
          displayName={displayName}
        />
      )}
    </motion.div>
  );
}
