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
import { createContext, useContext } from "react";

export interface AuthInfo {
  role: "admin" | "viewer" | "anonymous";
  method: string;
  scope_type: string;
  scope_id: string | null;
}

/**
 * Запрашивает /api/me для определения текущей роли.
 * LAN-пользователи получают admin автоматически.
 */
export function useAuthQuery() {
  return useQuery<AuthInfo>({
    queryKey: ["auth", "me"],
    queryFn: () => apiFetch<AuthInfo>("/api/me"),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

// Context для передачи AuthInfo через дерево компонентов
export const AuthContext = createContext<AuthInfo>({
  role: "admin",
  method: "lan",
  scope_type: "all",
  scope_id: null,
});

export function useAuth(): AuthInfo {
  return useContext(AuthContext);
}

export function useIsAdmin(): boolean {
  return useAuth().role === "admin";
}
