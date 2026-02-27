import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Wifi, WifiOff } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { EquipmentOut } from "@/hooks/use-equipment";
import StatusBadge from "./StatusBadge";
import MetricDisplay from "./MetricDisplay";
import { useTelemetryStore, makeEquipKey } from "@/stores/telemetry-store";
import { formatRelativeTime } from "@/lib/format";
import {
  fahrenheitToCelsius,
  secondsToMotohours,
} from "@/lib/conversions";

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

  // Тик каждые 5 сек для обновления относительного времени и свежести
  const [now, setNow] = useState(Date.now());
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

  // Live values override REST values if available
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

  const installedPower = liveVal(43019) ?? eq.installed_power_kw;
  const currentLoad = liveVal(40034) ?? eq.current_load_kw;

  const rawHours = liveVal(40070);
  const engineHours =
    rawHours != null ? secondsToMotohours(rawHours) : eq.engine_hours;

  const rawTemp = liveVal(40063);
  const tempReg = liveRegs?.get(40063);
  let oilTempC: number | null = null;
  if (rawTemp != null) {
    const unit = tempReg?.unit || "";
    oilTempC =
      unit.toLowerCase().includes("f")
        ? fahrenheitToCelsius(rawTemp)
        : Math.round(rawTemp * 10) / 10;
  } else {
    oilTempC = eq.oil_temp_c;
  }

  const oilPressure = liveVal(40062) ?? eq.oil_pressure_kpa;

  const displayName =
    eq.name || `${eq.equip_type} #${eq.panel_id}`;

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
          <StatusBadge status={engineStatus} />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <MetricDisplay
              label="Мощность уст."
              value={installedPower}
              unit="кВт"
              decimals={0}
            />
            <MetricDisplay
              label="Нагрузка"
              value={currentLoad}
              unit="кВт"
              decimals={1}
            />
            <MetricDisplay
              label="Моточасы"
              value={engineHours}
              unit="ч"
              decimals={0}
            />
            <MetricDisplay label="t масла" value={oilTempC} unit="°C" />
            <MetricDisplay
              label="P масла"
              value={oilPressure}
              unit="кПа"
              decimals={0}
            />
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
