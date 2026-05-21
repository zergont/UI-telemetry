import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Wifi, WifiOff } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { EquipmentOut } from "@/hooks/use-equipment";
import MetricDisplay from "./MetricDisplay";
import EngineStatusBadges from "./EngineStatusBadges";
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
    if (
      reg.raw === 65535 ||
      reg.raw === 32767 ||
      (reg.reason && reg.reason.toUpperCase().includes("NA"))
    )
      return null;
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
          const unit = liveRegs?.get(40063)?.unit ?? "";
          return unit.toLowerCase().includes("f")
            ? fahrenheitToCelsius(raw)
            : Math.round(raw * 10) / 10;
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
        className="cursor-pointer border transition-shadow hover:shadow-lg"
        onClick={() =>
          navigate(
            `/objects/${eq.router_sn}/equipment/${eq.equip_type}/${eq.panel_id}`,
          )
        }
      >
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
      </Card>
    </motion.div>
  );
}
