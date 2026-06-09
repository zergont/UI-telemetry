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
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { EquipmentOut } from "@/hooks/use-equipment";
import { useMachineAnalytics, type SeverityLevel } from "@/hooks/use-analytics";
import MetricDisplay from "./MetricDisplay";
import EngineStatusBadges from "./EngineStatusBadges";
import AnalyticsStrip from "./AnalyticsStrip";
import AnalyticsCalendarDialog from "./AnalyticsCalendarDialog";
import { useTelemetryStore, makeEquipKey } from "@/stores/telemetry-store";
import { formatRelativeTime } from "@/lib/format";
import {
  fahrenheitToCelsius,
  secondsToMotohours,
} from "@/lib/conversions";
import {
  useDguCardSettings,
  DEFAULT_DGU_PARAMS,
} from "@/hooks/use-dgu-card-settings";

/** Порог «нет данных» для отдельной панели, мс */
const PANEL_STALE_MS = 30_000;

/** Акцент карточки по severity_level из cg-analytics */
const CARD_ACCENT: Record<
  SeverityLevel,
  { bar: string; card: string }
> = {
  норма: {
    bar: "via-emerald-500/60",
    card: "hover:border-emerald-500/25 hover:shadow-emerald-500/10",
  },
  внимание: {
    bar: "via-amber-400/80",
    card: "border-amber-500/25 shadow-amber-500/5 hover:border-amber-500/40 hover:shadow-amber-500/15",
  },
  тревога: {
    bar: "via-red-500/80",
    card: "border-red-500/30 shadow-red-500/10 hover:border-red-500/50 hover:shadow-red-500/25",
  },
};

interface Props {
  equipment: EquipmentOut;
}

export default function DguCard({ equipment: eq }: Props) {
  const navigate = useNavigate();
  const key = makeEquipKey(eq.router_sn, eq.equip_type, eq.panel_id);

  const liveRegs = useTelemetryStore((s) => s.registers.get(key));
  const liveStatus = useTelemetryStore((s) => s.statuses.get(key));
  const lastUpdate = useTelemetryStore((s) => s.lastUpdate.get(key));

  const { data: cardParams = DEFAULT_DGU_PARAMS } = useDguCardSettings();

  // ИИ-аналитика из cg-analytics (undefined — сервис недоступен или машина не наблюдается)
  const analytics = useMachineAnalytics(eq.router_sn, eq.equip_type, eq.panel_id);
  const accent = analytics
    ? CARD_ACCENT[analytics.severity_level ?? "норма"] ?? CARD_ACCENT["норма"]
    : null;
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Тик каждые 5 сек для обновления относительного времени и свежести
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  // Свежесть данных конкретной панели
  const panelFresh = lastUpdate != null && now - lastUpdate < PANEL_STALE_MS;

  // Статус связи: WS (live) или REST
  const connectionStatus = liveStatus ?? eq.connection_status;
  // Если связь есть — показываем состояние двигателя (RUN/STOP/ALARM),
  // иначе — статус связи (DELAY/OFFLINE)
  let engineStatus: string;
  if (connectionStatus === "ONLINE") {
    engineStatus =
      eq.engine_state !== "OFFLINE" ? eq.engine_state : "ONLINE";
  } else {
    engineStatus = connectionStatus;
  }

  // Возвращает live-значение регистра или null при невалидных данных
  function liveVal(addr: number): number | null {
    const reg = liveRegs?.get(addr);
    if (!reg) return null;
    if (reg.raw === 65535 || reg.raw === 32767) return null;
    return reg.value;
  }

  // Возвращает итоговое значение для регистра с учётом REST-фолбека и конвертаций
  function resolveValue(addr: number): number | null {
    switch (addr) {
      case 43019:
        return liveVal(43019) ?? eq.installed_power_kw;
      case 40034:
        return liveVal(40034) ?? eq.current_load_kw;
      case 40070: {
        const raw = liveVal(40070);
        return raw != null ? secondsToMotohours(raw) : eq.engine_hours;
      }
      case 40063: {
        const raw = liveVal(40063);
        if (raw != null) {
          // unit comes from REST equipment card (already Celsius-converted on backend)
          // We apply same conversion logic using eq.oil_temp_c as a reference
          return raw > 150 ? fahrenheitToCelsius(raw) : Math.round(raw * 10) / 10;
        }
        return eq.oil_temp_c;
      }
      case 40062:
        return liveVal(40062) ?? eq.oil_pressure_kpa;
      default:
        return liveVal(addr);
    }
  }

  const displayName = eq.name || `${eq.equip_type} #${eq.panel_id}`;

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
      <Card
        className={`relative cursor-pointer overflow-hidden border transition-all duration-300 hover:shadow-lg ${accent?.card ?? "hover:border-foreground/15"}`}
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
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <h3 className="font-semibold text-base">{displayName}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              {/* Индикатор связи с панелью */}
              {panelFresh ? (
                <span className="flex items-center gap-1 text-xs text-green-500">
                  <Wifi className="h-3 w-3" />
                  на связи
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-red-400">
                  <WifiOff className="h-3 w-3" />
                  нет данных
                </span>
              )}
              {lastUpdate && (
                <span className="text-xs text-muted-foreground">
                  · {formatRelativeTime(new Date(lastUpdate))}
                </span>
              )}
            </div>
          </div>
          <EngineStatusBadges
            liveRegs={liveRegs}
            panelFresh={panelFresh}
            fallbackStatus={engineStatus}
          />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {cardParams.map((param) => (
              <MetricDisplay
                key={param.addr}
                label={param.label}
                value={resolveValue(param.addr)}
                unit={param.unit}
                decimals={param.decimals}
              />
            ))}
          </div>
        </CardContent>
        {analytics && (
          <AnalyticsStrip
            analytics={analytics}
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
