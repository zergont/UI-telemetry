import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface NotificationOut {
  addr: number;
  bit: number;
  fault_name: string | null;
  severity: string | null;   // 'shutdown' | 'warning' | 'info'
  fault_start: string;
  fault_end: string | null;  // null = активна прямо сейчас
  duration_seconds: number | null;
}

export function useNotifications(
  routerSn: string,
  equipType: string,
  panelId: number | string,
) {
  return useQuery({
    queryKey: ["notifications", routerSn, equipType, panelId],
    queryFn: () =>
      apiFetch<NotificationOut[]>(
        `/api/notifications/${routerSn}/${equipType}/${panelId}`,
      ),
    enabled: !!routerSn && !!equipType,
    refetchInterval: 30_000,
  });
}
