import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface HistoryPoint {
  ts: string | null;
  value: number | null;
  min_value: number | null;
  max_value: number | null;
  text: string | null;
  reason: string | null;
}

export function useHistory(
  routerSn: string,
  equipType: string,
  panelId: number | string,
  addr: number,
  start: string,
  end: string,
  points?: number,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ["history", routerSn, equipType, panelId, addr, start, end, points],
    queryFn: () => {
      const params = new URLSearchParams({
        router_sn: routerSn,
        equip_type: equipType,
        panel_id: String(panelId),
        addr: String(addr),
        start,
        end,
      });
      if (points) params.set("points", String(points));
      return apiFetch<HistoryPoint[]>(`/api/history?${params}`);
    },
    enabled: enabled && !!routerSn && !!equipType,
    placeholderData: keepPreviousData,
  });
}
