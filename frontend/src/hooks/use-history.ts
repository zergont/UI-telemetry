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

export interface GapZone {
  from_ts: string;
  to_ts: string;
}

export interface HistoryResponse {
  points: HistoryPoint[];
  first_data_at: string | null;
  gaps: GapZone[];
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
  minGapPoints: number = 3,
) {
  return useQuery({
    queryKey: ["history", routerSn, equipType, panelId, addr, start, end, points, minGapPoints],
    queryFn: () => {
      const params = new URLSearchParams({
        router_sn: routerSn,
        equip_type: equipType,
        panel_id: String(panelId),
        addr: String(addr),
        start,
        end,
        min_gap_points: String(minGapPoints),
      });
      if (points) params.set("points", String(points));
      return apiFetch<HistoryResponse>(`/api/history?${params}`);
    },
    enabled: enabled && !!routerSn && !!equipType,
    placeholderData: keepPreviousData,
  });
}
