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

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Wifi, WifiOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { EquipmentOut } from "@/hooks/use-equipment";
import { useMachineAnalytics, type SeverityLevel } from "@/hooks/use-analytics";
import { useTelemetryStore, makeEquipKey } from "@/stores/telemetry-store";
import { formatRelativeTime } from "@/lib/format";
import { fahrenheitToCelsius, secondsToMotohours } from "@/lib/conversions";
import AnalyticsStrip from "./AnalyticsStrip";
import AnalyticsCalendarDialog from "./AnalyticsCalendarDialog";
import LedPanel from "./panel/LedPanel";
import LoadGauge from "./panel/LoadGauge";
import PhaseBars from "./panel/PhaseBars";
import DigitalWindow from "./panel/DigitalWindow";
import { OilBox, IconValueBox } from "./panel/ParamBoxes";
import { CoolantIcon, BatteryIcon } from "./panel/PanelIcons";
import {
  REG,
  PANEL_BOX,
  batteryState,
  coolantState,
  rpmState,
  loadZoneColor,
  nominalCurrentA,
  formatHours,
} from "./panel/registers";

/** Порог «нет данных» для отдельной панели, мс */
const PANEL_STALE_MS = 30_000;

export type DguCardVariant = "minimal" | "normal" | "extended";

/** Акцент карточки по severity_level (4 уровня, cg-analytics v4.1.0) */
const CARD_ACCENT: Record<
  SeverityLevel,
  { bar: string; card: string }
> = {
  норма: {
    bar: "via-emerald-500/60",
    card: "hover:border-emerald-500/25 hover:shadow-emerald-500/10",
  },
  внимание: {
    bar: "via-yellow-400/80",
    card: "border-yellow-500/25 shadow-yellow-500/5 hover:border-yellow-500/40 hover:shadow-yellow-500/15",
  },
  предупреждение: {
    bar: "via-orange-500/80",
    card: "border-orange-500/30 shadow-orange-500/5 hover:border-orange-500/45 hover:shadow-orange-500/20",
  },
  авария: {
    bar: "via-red-500/80",
    card: "border-red-500/30 shadow-red-500/10 hover:border-red-500/50 hover:shadow-red-500/25",
  },
};

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
  const key = makeEquipKey(eq.router_sn, eq.equip_type, eq.panel_id);

  const liveRegs = useTelemetryStore((s) => s.registers.get(key));
  const lastUpdate = useTelemetryStore((s) => s.lastUpdate.get(key));

  // Тик каждые 5 сек для обновления относительного времени и свежести
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const panelFresh = lastUpdate != null && now - lastUpdate < PANEL_STALE_MS;

  // ИИ-аналитика из cg-analytics (undefined — сервис недоступен или машина не наблюдается)
  const analytics = useMachineAnalytics(eq.router_sn, eq.equip_type, eq.panel_id);
  const accent = analytics
    ? CARD_ACCENT[analytics.severity_level ?? "норма"] ?? CARD_ACCENT["норма"]
    : null;
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Live-значение регистра (null при невалидных данных)
  function liveVal(addr: number): number | null {
    const reg = liveRegs?.get(addr);
    if (!reg) return null;
    if (reg.raw === 65535 || reg.raw === 32767) return null;
    return reg.value;
  }
  function liveRaw(addr: number): number | null {
    const reg = liveRegs?.get(addr);
    if (!reg) return null;
    if (reg.raw === 65535 || reg.raw === 32767) return null;
    return reg.raw;
  }

  // ── Регистры панели ────────────────────────────────────────────────
  const modeRaw = panelFresh ? liveRaw(REG.MODE) : null;
  const stateRaw = panelFresh ? liveRaw(REG.RUN_STATE) : null;
  const faultRaw = panelFresh ? liveRaw(REG.FAULT_TYPE) : null;
  const running =
    stateRaw != null
      ? stateRaw >= 1 && stateRaw <= 6
      : eq.engine_state === "RUN";

  const loadKw = liveVal(REG.LOAD_KW) ?? eq.current_load_kw;
  const ratedKw = liveVal(REG.RATED_KW) ?? eq.installed_power_kw;
  const loadPct =
    loadKw != null && ratedKw != null && ratedKw > 0
      ? (loadKw / ratedKw) * 100
      : null;

  const oilPress = liveVal(REG.OIL_PRESS) ?? eq.oil_pressure_kpa;
  const oilTempRaw = liveVal(REG.OIL_TEMP);
  const oilTemp =
    oilTempRaw != null
      ? oilTempRaw > 150
        ? fahrenheitToCelsius(oilTempRaw)
        : Math.round(oilTempRaw * 10) / 10
      : eq.oil_temp_c;
  const coolant = liveVal(REG.COOLANT_TEMP);
  const battery = liveVal(REG.BATTERY_V);
  const rpm = liveVal(REG.RPM);
  const voltage = liveVal(REG.VOLTAGE_LL);
  const currents = [
    liveVal(REG.CURRENT_L1),
    liveVal(REG.CURRENT_L2),
    liveVal(REG.CURRENT_L3),
  ];
  const nominalA = nominalCurrentA(ratedKw, voltage);

  const hoursRaw = liveVal(REG.ENGINE_HOURS);
  const hours = hoursRaw != null ? secondsToMotohours(hoursRaw) : eq.engine_hours;

  const displayName = eq.name || `${eq.equip_type} #${eq.panel_id}`;
  const rpmSt = rpmState(rpm, running);

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
      <LedPanel
        modeRaw={modeRaw}
        stateRaw={stateRaw}
        faultRaw={faultRaw}
        size={variant === "minimal" ? "sm" : "md"}
      />
    </div>
  );

  const motoBox = (
    <div
      className={`flex flex-1 flex-col items-center justify-center gap-0.5 px-2.5 py-2 ${PANEL_BOX} border-border/60`}
    >
      <span className="text-[7px] tracking-[0.14em] text-muted-foreground/80">
        МОТОЧАСЫ
      </span>
      <span
        className={`font-mono text-[14px] tabular-nums tracking-[0.1em] ${
          hours != null ? "text-green-500 dark:text-green-400" : "text-muted-foreground"
        }`}
      >
        {formatHours(hours)}
      </span>
    </div>
  );

  const oilRow = <OilBox pressKpa={oilPress} tempC={oilTemp} running={running} />;
  const coolantBox = (
    <IconValueBox
      icon={<CoolantIcon className="h-5 w-5" />}
      value={coolant}
      unit="°C"
      state={coolantState(coolant, running)}
    />
  );
  const batteryBox = (
    <IconValueBox
      icon={<BatteryIcon className="h-5 w-5" />}
      value={battery}
      unit="В"
      decimals={1}
      state={batteryState(battery)}
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
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              {oilRow}
              <div className="flex gap-2">
                {coolantBox}
                {variant === "extended" ? batteryBox : motoBox}
              </div>
            </div>
          </div>
        )}

        {variant === "extended" && (
          <div className="mt-3 flex items-stretch gap-2.5 px-6">
            <div className="min-w-0 flex-[1.2]">
              <PhaseBars currents={currents} nominalA={nominalA} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
              <DigitalWindow
                label="НАПРЯЖЕНИЕ"
                value={voltage != null ? `${Math.round(voltage)} В` : "—"}
                tone={running && voltage != null && voltage > 100 ? "active" : "idle"}
              />
              <DigitalWindow
                label="МОТОЧАСЫ"
                value={formatHours(hours)}
                tone={hours != null ? "active" : "idle"}
                wide
              />
              <DigitalWindow
                label="ОБОРОТЫ"
                value={rpm != null ? String(Math.round(rpm)) : "—"}
                tone={rpmSt === "crit" ? "crit" : rpmSt === "idle" ? "idle" : "active"}
              />
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
