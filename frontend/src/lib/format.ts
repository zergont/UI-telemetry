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

export function formatMetric(
  value: number | null | undefined,
  unit: string,
  decimals: number = 1,
  reason?: string | null,
): { display: string; tooltip?: string } {
  if (value == null || value === undefined) {
    return { display: "\u2014", tooltip: reason || "Нет данных" };
  }
  return { display: `${value.toFixed(decimals)} ${unit}` };
}

export function formatRelativeTime(ts: string | Date): string {
  const date = typeof ts === "string" ? new Date(ts) : ts;
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diff < 5) return "только что";
  if (diff < 60) return `${diff} сек назад`;
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return date.toLocaleString("ru-RU");
}
