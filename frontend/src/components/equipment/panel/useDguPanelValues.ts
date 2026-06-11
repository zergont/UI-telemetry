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

import { useEffect, useState } from "react";
import type { EquipmentOut } from "@/hooks/use-equipment";
import { useTelemetryStore, makeEquipKey } from "@/stores/telemetry-store";
import { fahrenheitToCelsius, secondsToMotohours } from "@/lib/conversions";
import { REG, nominalCurrentA } from "./registers";

/** Порог «нет данных» для отдельной панели, мс */
export const PANEL_STALE_MS = 30_000;

export interface DguPanelValues {
  panelFresh: boolean;
  lastUpdate: number | undefined;
  /** 40010 Switch Position (null без свежих данных) */
  modeRaw: number | null;
  /** 40011 Run Sequence State */
  stateRaw: number | null;
  /** 40013 Тип неисправности */
  faultRaw: number | null;
  running: boolean;
  loadKw: number | null;
  ratedKw: number | null;
  loadPct: number | null;
  oilPress: number | null;
  oilTemp: number | null;
  coolant: number | null;
  battery: number | null;
  rpm: number | null;
  voltage: number | null;
  currents: (number | null)[];
  nominalA: number | null;
  hours: number | null;
}

/**
 * Живые значения панели ДГУ: WS-регистры с REST-фолбеком из EquipmentOut.
 * Внутри — секундный тик для свежести данных и относительного времени.
 */
export function useDguPanelValues(
  routerSn: string,
  equipType: string,
  panelId: number | string,
  fallback?: EquipmentOut | null,
): DguPanelValues {
  const key = makeEquipKey(routerSn, equipType, panelId);
  const liveRegs = useTelemetryStore((s) => s.registers.get(key));
  const lastUpdate = useTelemetryStore((s) => s.lastUpdate.get(key));

  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const panelFresh = lastUpdate != null && now - lastUpdate < PANEL_STALE_MS;

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

  const modeRaw = panelFresh ? liveRaw(REG.MODE) : null;
  const stateRaw = panelFresh ? liveRaw(REG.RUN_STATE) : null;
  const faultRaw = panelFresh ? liveRaw(REG.FAULT_TYPE) : null;
  const running =
    stateRaw != null
      ? stateRaw >= 1 && stateRaw <= 6
      : fallback?.engine_state === "RUN";

  const loadKw = liveVal(REG.LOAD_KW) ?? fallback?.current_load_kw ?? null;
  const ratedKw = liveVal(REG.RATED_KW) ?? fallback?.installed_power_kw ?? null;
  const loadPct =
    loadKw != null && ratedKw != null && ratedKw > 0
      ? (loadKw / ratedKw) * 100
      : null;

  const oilPress = liveVal(REG.OIL_PRESS) ?? fallback?.oil_pressure_kpa ?? null;
  const oilTempRaw = liveVal(REG.OIL_TEMP);
  const oilTemp =
    oilTempRaw != null
      ? oilTempRaw > 150
        ? fahrenheitToCelsius(oilTempRaw)
        : Math.round(oilTempRaw * 10) / 10
      : fallback?.oil_temp_c ?? null;

  const voltage = liveVal(REG.VOLTAGE_LL);
  const hoursRaw = liveVal(REG.ENGINE_HOURS);

  return {
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
    coolant: liveVal(REG.COOLANT_TEMP),
    battery: liveVal(REG.BATTERY_V),
    rpm: liveVal(REG.RPM),
    voltage,
    currents: [
      liveVal(REG.CURRENT_L1),
      liveVal(REG.CURRENT_L2),
      liveVal(REG.CURRENT_L3),
    ],
    nominalA: nominalCurrentA(ratedKw, voltage),
    hours: hoursRaw != null ? secondsToMotohours(hoursRaw) : fallback?.engine_hours ?? null,
  };
}
