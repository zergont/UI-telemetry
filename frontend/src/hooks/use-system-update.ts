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

import { useQuery, useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface SystemVersion {
  version: string;
  commit: string;
  branch: string;
}

export interface SystemUpdateCheck {
  up_to_date: boolean;
  behind_count: number;
  commits: { hash: string; message: string }[];
  error?: string;
}

export interface SystemUpdateStatus {
  state: "idle" | "checking" | "pulling" | "installing" | "building" | "restarting" | "done" | "error";
  progress: string;
  log: string[];
  error: string | null;
  available: SystemUpdateCheck | null;
}

export function useSystemVersion() {
  return useQuery<SystemVersion>({
    queryKey: ["system-version"],
    queryFn: () => apiFetch<SystemVersion>("/api/system/version"),
    staleTime: 60_000,
    retry: false,
  });
}

export function useCheckSystemUpdate() {
  return useMutation({
    mutationFn: () => apiFetch<SystemUpdateCheck>("/api/system/check-update"),
  });
}

export function useTriggerSystemUpdate() {
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; error?: string }>("/api/system/update", { method: "POST" }),
  });
}

export function useSystemUpdateStatus(enabled: boolean) {
  return useQuery<SystemUpdateStatus>({
    queryKey: ["system-update-status"],
    queryFn: () => apiFetch<SystemUpdateStatus>("/api/system/update-status"),
    refetchInterval: enabled ? 2_000 : false,
    enabled,
  });
}
