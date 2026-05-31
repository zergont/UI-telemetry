import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface NotificationOut {
  addr: number;
  bit: number;
  fault_name: string | null;         // English
  fault_description: string | null;  // Русское описание
  severity: string | null;           // 'shutdown' | 'warning' | 'unknown'
  fault_start: string;
  fault_end: string | null;          // null = активна прямо сейчас
  duration_seconds: number | null;
}

export type NotificationsMode = "latest" | "all";

export function useNotifications(
  routerSn: string,
  equipType: string,
  panelId: number | string,
  mode: NotificationsMode = "latest",
) {
  return useQuery({
    queryKey: ["notifications", routerSn, equipType, panelId, mode],
    queryFn: () =>
      apiFetch<NotificationOut[]>(
        `/api/notifications/${routerSn}/${equipType}/${panelId}?mode=${mode}`,
      ),
    enabled: !!routerSn && !!equipType,
    refetchInterval: 30_000,
  });
}
