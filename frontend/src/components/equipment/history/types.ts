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

/* ── Chart types ─────────────────────────────────────────────────────────── */

export interface ViewportRange {
  from: number; // Unix ms
  to: number;   // Unix ms
}

export interface ChartPoint {
  ts: number;           // Unix ms
  value: number | null;
  minValue?: number | null;
  maxValue?: number | null;
  sampleCount?: number;
}

/* ── API types ──────────────────────────────────────────────────────────── */

export interface HistoryPoint {
  ts: string | null;
  value: number | null;
  min_value: number | null;
  max_value: number | null;
  open_value: number | null;
  close_value: number | null;
  sample_count: number | null;
  text: string | null;
  reason: string | null;
}

export interface GapZone {
  gap_start: string;  // ISO datetime
  gap_end: string | null;  // null = ongoing
}

export interface HistoryResponse {
  points: HistoryPoint[];
  first_data_at: string | null;
  gaps: GapZone[];
  /** Фактическое разрешение ответа в секундах; 0 = сырые точки */
  resolution_secs?: number;
}
