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

export type SeverityLevel = "норма" | "внимание" | "тревога";
export type CokingRisk = "GREEN" | "YELLOW" | "RED";

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
  status_text: string | null;
  status_updated: string | null;
  coking_risk: CokingRisk | null;
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

export type SegmentSeverity = "SHUTDOWN" | "ALARM" | "WARNING" | "INFO" | null;

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
