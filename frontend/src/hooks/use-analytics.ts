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

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

/**
 * Итоговый уровень: норма < предупреждение (аналитика) < внимание (панель) < авария (панель).
 * Уровень однозначно кодирует источник: предупреждение — только аналитика,
 * внимание/авария — только панель управления (CONTROLLER_FAULT).
 */
export type SeverityLevel = "норма" | "предупреждение" | "внимание" | "авария";
export type CokingRisk = "GREEN" | "YELLOW" | "RED";

/** Одна открытая тревога из /api/machines active_alarms. severity — англ. шкала. */
export interface ActiveAlarm {
  scenario: string;
  severity: "SHUTDOWN" | "WARNING" | "CAUTION" | "ALARM" | "INFO" | null;
  source: "panel" | "analytics" | null;
  /** для панельных — регистр/бит; у аналитических null */
  addr: number | null;
  bit: number | null;
  name: string | null;
  since: string | null;
  duration_sec: number;
  gate_suppressed: boolean;
}

export interface MachineAnalytics {
  router_sn: string;
  equip_type: string;
  panel_id: number;
  name: string;
  manufacturer: string | null;
  model: string | null;
  status: "running" | "stopped";
  run_state: number | null;
  run_state_label: string | null;
  severity_level: SeverityLevel | null;
  /** Срабатывание аналитики проверено и отменено гейтом Claude */
  gate_checked: boolean;
  /** Сколько предупреждений обработал гейт за текущий сегмент */
  gate_events_count: number;
  gate_cancelled_count: number;
  status_text: string | null;
  /** Структурный статус: режим, время в режиме, текст главной тревоги */
  mode_label: string | null;
  time_in_mode_sec: number | null;
  alarm_text: string | null;
  status_updated: string | null;
  warning_analysis_md: string | null;
  coking_risk: CokingRisk | null;
  /** Открытые тревоги (per-fault): панельные по addr/bit, аналитические по сценарию */
  active_alarms: ActiveAlarm[] | null;
  /** Максимальный ts строки телеметрии, виденной аналитикой (ISO) */
  last_data_ts: string | null;
  /** Телеметрия аналитики устарела: статус/severity отражают last_data_ts, а не «сейчас».
   *  UI скрывает блок аналитики — «норма от ИИ» без данных подрывает доверие. */
  data_stale: boolean;
}

/**
 * Состояние машин из cg-analytics (через прокси дашборда).
 * Если сервис недоступен/отключён — data = undefined, UI прячет блоки аналитики.
 */
export function useAnalyticsMachines() {
  return useQuery({
    queryKey: ["analytics", "machines"],
    queryFn: () => apiFetch<MachineAnalytics[]>("/api/analytics/machines"),
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: false,
  });
}

// Актуальная шкала cg-analytics v4.8.9+: SHUTDOWN / WARNING / CAUTION.
// ALARM и INFO — легаси-значения старых сегментов, рендер их тоже понимает.
export type SegmentSeverity =
  | "SHUTDOWN" | "WARNING" | "CAUTION"
  | "ALARM" | "INFO"
  | null;

export interface SegmentOut {
  id: number;
  t_start: string | null;
  t_end: string | null;
  is_open: boolean;
  run_state: number | null;
  run_state_label: string | null;
  duration_sec: number | null;
  cause_close: string | null;
  severity: SegmentSeverity;
  /** Операционные сутки сегмента (YYYY-MM-DD, граница daily_split_hour движка) */
  op_day: string | null;
  /** Срабатывание аналитики проверено и отменено гейтом Claude */
  gate_checked: boolean;
  analytics_version: string | null;
  has_report: boolean;
  has_claude: boolean;
}

export interface SegmentAnalysis {
  status: "pending" | "processing" | "done" | "error" | null;
  conclusion_md: string | null;
  humanized_md: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SegmentDetail extends SegmentOut {
  router_sn: string;
  equip_type: string;
  panel_id: number;
  report_md: string | null;
  analysis: SegmentAnalysis | null;
  /** Онлайн-анализ предупреждения (гейт Claude) — есть и у открытого сегмента */
  warning_analysis_md: string | null;
  status_text: string | null;
}

/**
 * Сегменты машины за календарный месяц (для диалога-календаря).
 * router_sn/equip_type/panel_id — из ответа cg-analytics (/machines),
 * а не из телеметрии дашборда: equip_type может различаться.
 */
export function useMachineSegments(
  machine: Pick<MachineAnalytics, "router_sn" | "equip_type" | "panel_id"> | undefined,
  year: number,
  month: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      "analytics",
      "segments",
      machine?.router_sn,
      machine?.equip_type,
      machine?.panel_id,
      year,
      month,
    ],
    queryFn: () =>
      apiFetch<SegmentOut[]>(
        `/api/analytics/machine/${machine!.router_sn}/${machine!.equip_type}/${machine!.panel_id}/segments?year=${year}&month=${month}`,
      ),
    enabled: enabled && !!machine,
    staleTime: 30_000,
    retry: false,
  });
}

/** Детальный отчёт по сегменту; поллинг 10 с, пока заключение ИИ в очереди/обработке. */
export function useSegmentDetail(segId: number | null) {
  return useQuery({
    queryKey: ["analytics", "segment", segId],
    queryFn: () => apiFetch<SegmentDetail>(`/api/analytics/segment/${segId}`),
    enabled: segId != null,
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.analysis?.status;
      return status === "pending" || status === "processing" ? 10_000 : false;
    },
  });
}

/**
 * Аналитика конкретной машины.
 * equip_type в cg-analytics задаётся при создании наблюдения и может не совпадать
 * со значением из телеметрии — поэтому фолбэк по router_sn + panel_id.
 */
export function useMachineAnalytics(
  routerSn: string,
  equipType: string,
  panelId: number | string,
): MachineAnalytics | undefined {
  const { data } = useAnalyticsMachines();
  if (!data) return undefined;
  const pid = Number(panelId);
  return (
    data.find(
      (m) =>
        m.router_sn === routerSn &&
        m.equip_type === equipType &&
        m.panel_id === pid,
    ) ?? data.find((m) => m.router_sn === routerSn && m.panel_id === pid)
  );
}
