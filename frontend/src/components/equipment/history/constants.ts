/* ── Chart configuration ─────────────────────────────────────────────────── */

/** Дефолтный видимый диапазон при первой загрузке — 4 часа */
export const DEFAULT_SPAN_MS = 4 * 3_600_000;

/** Минимальный видимый диапазон (5 сек — raw-точки каждые ~2 сек) */
export const MIN_SPAN_MS = 5_000;

/** Сколько «экранов» загружаем за один запрос (1 видимый + по бокам) */
export const PREFETCH_SCREENS = 3;

/** Порог подгрузки: если невидимый буфер < 0.5 экрана — грузим ещё */
export const LOAD_TRIGGER = 0.5;

/** Дебаунс перед запросом данных при навигации (мс) */
export const FETCH_DEBOUNCE_MS = 200;

/** Скорость зума за один «тик» колёсика (20%) */
export const ZOOM_SPEED = 0.2;

/** Ширина голубой полоски «будущего» справа от now (мс) */
export const FUTURE_PAD_MS = 2 * 60_000;

/** Регистры, доступные для выбора */
export const REGISTER_OPTIONS = [
  { addr: 40034, label: "Нагрузка",   unit: "кВт", color: "#22c55e" },
  { addr: 40035, label: "Ток",        unit: "А",   color: "#3b82f6" },
  { addr: 40038, label: "Напряжение", unit: "В",   color: "#f59e0b" },
  { addr: 40063, label: "t масла",    unit: "°C",  color: "#ef4444" },
  { addr: 40062, label: "P масла",    unit: "кПа", color: "#8b5cf6" },
  { addr: 40070, label: "Моточасы",   unit: "с",   color: "#06b6d4" },
] as const;
