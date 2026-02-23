import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface HistoryPoint {
  ts: string | null;
  value: number | null;
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
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ["history", routerSn, equipType, panelId, addr, start, end],
    queryFn: () => {
      const params = new URLSearchParams({
        router_sn: routerSn,
        equip_type: equipType,
        panel_id: String(panelId),
        addr: String(addr),
        start,
        end,
      });
      return apiFetch<HistoryPoint[]>(`/api/history?${params}`);
    },
    enabled: enabled && !!routerSn && !!equipType,
  });
}
