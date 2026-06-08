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

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export function useRenameObject(routerSn: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<{ ok: boolean }>(`/api/objects/${routerSn}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["object", routerSn] });
      qc.invalidateQueries({ queryKey: ["objects"] });
    },
  });
}

export function useRenameEquipment(
  routerSn: string,
  equipType: string,
  panelId: string | number,
) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<{ ok: boolean }>(
        `/api/objects/${routerSn}/equipment/${equipType}/${panelId}/name`,
        {
          method: "PATCH",
          body: JSON.stringify({ name }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["equipment", routerSn] });
    },
  });
}
