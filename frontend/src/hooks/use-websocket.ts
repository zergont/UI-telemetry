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

import { useEffect } from "react";
import { getToken } from "@/lib/api";
import { createWebSocket } from "@/lib/ws";
import { useTelemetryStore } from "@/stores/telemetry-store";

export function useWebSocket(subscribe?: string) {
  const handleMessage = useTelemetryStore((s) => s.handleMessage);
  const setConnected = useTelemetryStore((s) => s.setConnected);

  useEffect(() => {
    const wsUrl =
      window.location.protocol === "https:"
        ? `wss://${window.location.host}/ws`
        : `ws://${window.location.host}/ws`;

    const ws = createWebSocket({
      url: wsUrl,
      token: getToken(),
      subscribe,
      onMessage: handleMessage,
      onStatusChange: setConnected,
    });

    return () => ws.close();
  }, [subscribe, handleMessage, setConnected]);
}
