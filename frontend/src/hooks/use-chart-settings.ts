import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface ChartRegister {
  addr: number;
  label: string;
  unit: string;
  color: string;
}

const QUERY_KEY = ["chart-settings"];

export const DEFAULT_REGISTERS: ChartRegister[] = [
  { addr: 40034, label: "Нагрузка",   unit: "кВт", color: "#22c55e" },
  { addr: 40035, label: "Ток",         unit: "А",   color: "#3b82f6" },
  { addr: 40038, label: "Напряжение",  unit: "В",   color: "#f59e0b" },
  { addr: 40063, label: "t масла",     unit: "°C",  color: "#ef4444" },
  { addr: 40062, label: "P масла",     unit: "кПа", color: "#8b5cf6" },
  { addr: 40070, label: "Моточасы",   unit: "с",   color: "#06b6d4" },
];

export function useChartSettings() {
  return useQuery<ChartRegister[]>({
    queryKey: QUERY_KEY,
    queryFn: () => apiFetch<ChartRegister[]>("/api/chart-settings"),
    staleTime: 5 * 60_000,
    placeholderData: DEFAULT_REGISTERS,
  });
}

export function useSaveChartSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (registers: ChartRegister[]) =>
      apiFetch<ChartRegister[]>("/api/chart-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registers),
      }),
    onSuccess: (data) => {
      qc.setQueryData(QUERY_KEY, data);
    },
  });
}
