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
