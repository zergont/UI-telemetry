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

/**
 * Регистры панели ДГУ (Cummins PCC3300, карта — knowledge_base cg-analytics).
 */
export const REG = {
  /** Switch Position: 0 Откл, 1 Авто, 2 Ручной */
  MODE: 40010,
  /** Run Sequence State: 0 Стоп … 3 Работа … 6 Переход на х.х. */
  RUN_STATE: 40011,
  /** Тип последней неисправности: 1 Предупр., 2 Снижение мощн., 3 Стоп с охл., 4 Авар. стоп */
  FAULT_TYPE: 40013,
  LOAD_KW: 40034,
  RATED_KW: 43019,
  /** Среднее линейное напряжение LL */
  VOLTAGE_LL: 40025,
  CURRENT_L1: 40026,
  CURRENT_L2: 40027,
  CURRENT_L3: 40028,
  OIL_PRESS: 40062,
  OIL_TEMP: 40063,
  COOLANT_TEMP: 40064,
  BATTERY_V: 40061,
  RPM: 40068,
  ENGINE_HOURS: 40070,
} as const;

/** Состояние параметра: норма / порог внимания / критично / неактуален (стоянка, нет данных) */
export type ParamState = "ok" | "warn" | "crit" | "idle";

/** Классы оформления по состоянию параметра */
export const STATE_CLASSES: Record<
  ParamState,
  { icon: string; value: string; box: string }
> = {
  ok: { icon: "text-green-500", value: "text-foreground/90", box: "border-border/60" },
  warn: { icon: "text-amber-400", value: "text-amber-400", box: "border-amber-500/40" },
  crit: { icon: "text-red-500", value: "text-red-400", box: "border-red-500/40" },
  idle: { icon: "text-muted-foreground/50", value: "text-foreground/70", box: "border-border/60" },
};

/** Общий стиль «приборного окошка» панели (работает в светлой и тёмной теме) */
export const PANEL_BOX =
  "rounded-lg border bg-muted/40 dark:bg-black/30";

export function oilPressState(kpa: number | null, running: boolean): ParamState {
  if (!running) return "idle";
  if (kpa == null) return "idle";
  if (kpa < 150) return "crit";
  if (kpa < 250) return "warn";
  return "ok";
}

export function oilTempState(c: number | null, running: boolean): ParamState {
  if (c == null) return "idle";
  if (c > 110) return "crit";
  if (c > 100) return "warn";
  return running ? "ok" : "idle";
}

/** Перегрев ОЖ важен и на остановленном двигателе */
export function coolantState(c: number | null, running: boolean): ParamState {
  if (c == null) return "idle";
  if (c > 103) return "crit";
  if (c > 95) return "warn";
  return running ? "ok" : "idle";
}

/** АКБ (24 В) актуальна всегда */
export function batteryState(v: number | null): ParamState {
  if (v == null) return "idle";
  if (v < 23 || v > 30) return "crit";
  if (v < 24.5 || v > 29) return "warn";
  return "ok";
}

/** Линейное напряжение 400 В: актуально на работающей установке */
export function voltageState(v: number | null, running: boolean): ParamState {
  if (v == null || v < 100) return "idle";
  if (!running) return "idle";
  if (v < 360 || v > 440) return "crit";
  if (v < 380 || v > 420) return "warn";
  return "ok";
}

export function rpmState(rpm: number | null, running: boolean): ParamState {
  if (!running || rpm == null || rpm <= 0) return "idle";
  const dev = Math.abs(rpm - 1500);
  if (dev > 150) return "crit";
  if (dev > 75) return "warn";
  return "ok";
}

/** Цвет дуги/полосы нагрузки по проценту от номинала */
export function loadZoneColor(pct: number): string {
  if (pct > 90) return "#ef4444";
  if (pct > 80) return "#f59e0b";
  if (pct < 30) return "#eab308";
  return "#10b981";
}

/**
 * Номинальный ток фазы, А: I = P / (√3 · U_LL · cosφ).
 * cosφ принят 0.8 (стандарт для ДГУ), U — живое линейное или 400 В.
 */
export function nominalCurrentA(
  ratedKw: number | null,
  voltageLL: number | null,
): number | null {
  if (!ratedKw || ratedKw <= 0) return null;
  const u = voltageLL && voltageLL > 100 ? voltageLL : 400;
  return (ratedKw * 1000) / (Math.sqrt(3) * u * 0.8);
}

/** Моточасы: всегда 6 знаков с ведущими нулями */
export function formatHours(hours: number | null): string {
  if (hours == null) return "——————";
  return String(Math.max(0, Math.floor(hours))).padStart(6, "0");
}
