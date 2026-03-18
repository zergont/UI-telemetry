export type DashboardStatus =
  | "RUN"
  | "STOP"
  | "ALARM"
  | "ONLINE"
  | "DELAY"
  | "OFFLINE";

interface StatusMeta {
  label: string;
  shortLabel: string;
  badgeClassName: string;
  dotClassName?: string;
  markerColor: string;
  markerPulse: boolean;
}

export const STATUS_META: Record<DashboardStatus, StatusMeta> = {
  RUN: {
    label: "РАБОТА",
    shortLabel: "онлайн",
    badgeClassName:
      "bg-green-500/15 text-green-500 border-green-500/20 hover:bg-green-500/25",
    dotClassName: "bg-green-500",
    markerColor: "#22c55e",
    markerPulse: true,
  },
  STOP: {
    label: "СТОП",
    shortLabel: "стоп",
    badgeClassName:
      "bg-gray-500/15 text-gray-400 border-gray-500/20 hover:bg-gray-500/25",
    markerColor: "#6b7280",
    markerPulse: false,
  },
  ALARM: {
    label: "АВАРИЯ",
    shortLabel: "авария",
    badgeClassName:
      "bg-red-500/15 text-red-500 border-red-500/20 hover:bg-red-500/25",
    dotClassName: "bg-red-500",
    markerColor: "#ef4444",
    markerPulse: true,
  },
  ONLINE: {
    label: "НА СВЯЗИ",
    shortLabel: "онлайн",
    badgeClassName:
      "bg-blue-500/15 text-blue-500 border-blue-500/20 hover:bg-blue-500/25",
    dotClassName: "bg-blue-500",
    markerColor: "#3b82f6",
    markerPulse: true,
  },
  DELAY: {
    label: "ЗАДЕРЖКА",
    shortLabel: "задержка",
    badgeClassName:
      "bg-violet-500/15 text-violet-500 border-violet-500/20 hover:bg-violet-500/25",
    markerColor: "#8b5cf6",
    markerPulse: false,
  },
  OFFLINE: {
    label: "НЕТ СВЯЗИ",
    shortLabel: "офлайн",
    badgeClassName:
      "bg-slate-500/15 text-slate-400 border-slate-500/20 hover:bg-slate-500/25",
    markerColor: "#64748b",
    markerPulse: false,
  },
};

export function getStatusMeta(status: string): StatusMeta {
  return STATUS_META[(status as DashboardStatus) || "OFFLINE"] ?? STATUS_META.OFFLINE;
}
