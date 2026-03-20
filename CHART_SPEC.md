# ТЗ: График истории показаний оборудования

## 1. Цель

Реализовать вкладку «История» на странице оборудования (`EquipmentPage`).
График — биржевого типа (lightweight-charts v5), поведение как в TradingView.

---

## 2. Источник данных

### 2.1 API эндпоинт

```
GET /api/history
Authorization: Bearer <jwt>

Параметры:
  router_sn      string   — серийный номер роутера
  equip_type     string   — тип оборудования (pcc, ...)
  panel_id       int      — номер панели
  addr           int      — адрес регистра Modbus
  start          ISO 8601 — начало диапазона
  end            ISO 8601 — конец диапазона
  points         int      — целевое кол-во точек (100–20000)
  min_gap_points int      — порог определения пробелов (1–20, def=3)
```

### 2.2 Ответ

```typescript
{
  points: Array<{
    ts:           string | null   // ISO 8601 UTC
    value:        number | null   // среднее за бакет (или сырое)
    min_value:    number | null   // минимум за бакет
    max_value:    number | null   // максимум за бакет
    open_value:   number | null   // первое значение в бакете
    close_value:  number | null   // последнее значение в бакете
    sample_count: number | null   // кол-во точек в бакете; NULL = нет данных
    text:         string | null
    reason:       string | null
  }>
  first_data_at: string | null    // ISO 8601 — самая ранняя запись в таблице
  gaps: Array<{
    from_ts: string               // ISO 8601
    to_ts:   string               // ISO 8601
  }>
}
```

### 2.3 Выбор таблицы бэкендом

Бэкенд сам выбирает таблицу по длине запроса `(end - start)`:

| Диапазон запроса | Таблица         | Бакет      | OHLC |
|------------------|-----------------|------------|------|
| ≤ 30 дней        | `history` (raw) | динамически от 1с до часов | да (open=close=value при raw) |
| 31–90 дней       | `history_1min`  | 1 минута   | да   |
| > 90 дней        | `history_1hour` | 1 час      | да   |

> **Важно:** `first_data_at = MIN(ts)` в **выбранной** таблице.
> При переключении диапазона таблица меняется, и `first_data_at` может прыгать.
> Фронт должен хранить минимальный из всех полученных значений.

---

## 3. Регистры для отображения

```typescript
const REGISTER_OPTIONS = [
  { addr: 40034, label: "Нагрузка",       unit: "кВт",  color: "#22c55e" },
  { addr: 40035, label: "Ток",            unit: "А",    color: "#3b82f6" },
  { addr: 40038, label: "Напряжение",     unit: "В",    color: "#f59e0b" },
  { addr: 40063, label: "t масла",        unit: "°C",   color: "#ef4444" },
  { addr: 40062, label: "P масла",        unit: "кПа",  color: "#8b5cf6" },
  { addr: 40070, label: "Моточасы",       unit: "с",    color: "#06b6d4" },
]
```

---

## 4. Пресеты временного диапазона

```typescript
const RANGE_MS: Record<HistoryRangeKey, number> = {
  "1h":  1 * 3600 * 1000,
  "6h":  6 * 3600 * 1000,
  "24h": 24 * 3600 * 1000,
  "7d":  7 * 86400 * 1000,
  "30d": 30 * 86400 * 1000,
  "90d": 90 * 86400 * 1000,
}
```

Кнопка пресета **активна** (подсвечена), если текущий видимый диапазон
отличается от значения пресета не более чем на **±10%**.

---

## 5. UX-правила (из INSTRUCTIONS.md)

1. **Live-режим:** зум привязан к **правому краю** (right-anchored).
2. **Ручной режим:** поведение как в биржевом терминале — свободный pan и zoom.
3. Кнопки пресетов — это кнопки масштаба. Активны при совпадении ±10%.
4. **Любой** pan или zoom выводит график из Live-режима.
5. Вернуться в Live можно **только** нажав кнопку пресета.
6. При возврате в Live через пресет — применяется масштаб этого пресета.

---

## 6. Архитектура компонентов

```
EquipmentPage
└── HistoryTab (новая вкладка)
    ├── useHistoryQuery     — React Query, данные
    ├── useChartViewport    — управление viewport (live/manual)
    └── HistoryChart        — обёртка lightweight-charts
```

### 6.1 `useHistoryQuery`

Тонкий хук поверх `@tanstack/react-query`.

```typescript
function useHistoryQuery(params: {
  routerSn: string
  equipType: string
  panelId: string
  addr: number
  start: string   // ISO
  end: string     // ISO
  points: number
  minGapPoints: number
  enabled: boolean
}): {
  data: HistoryResponse | undefined
  isLoading: boolean
  isFetching: boolean
}
```

- `staleTime`: 30_000 мс
- `placeholderData: keepPreviousData` — показываем старые данные во время рефетча

### 6.2 `useChartViewport`

Управляет состоянием viewport. Вся логика Live/Manual здесь.

```typescript
type CameraMode = "live" | "manual"

interface ViewportRange {
  from: number  // Unix ms
  to: number    // Unix ms
}

function useChartViewport(opts: {
  defaultPreset: HistoryRangeKey
  livePointTs: number | null          // последняя живая точка
}): {
  viewport: ViewportRange
  cameraMode: CameraMode
  activePreset: HistoryRangeKey | null
  // Вызывается из HistoryChart при pan/zoom пользователем:
  handleUserInteraction: (next: ViewportRange) => void
  // Вызывается кнопкой пресета:
  handlePresetClick: (preset: HistoryRangeKey) => void
}
```

**Тик Live-режима:** каждые 5 000 мс сдвигать viewport вправо,
чтобы правый край = `now + futureBuffer`.
Будущий буфер (`futureBuffer`) — по пресету:
```
1h  →  60s
6h  →  5min
24h → 10min
7d  →  1h
30d →  3h
90d → 12h
```

### 6.3 `HistoryChart`

Обёртка lightweight-charts v5.

```typescript
interface HistoryChartProps {
  data: ChartPoint[]              // [{ts: ms, value}] — уже с null-bridge для gaps
  livePoint: ChartPoint | null    // последняя живая точка из WS
  label: string
  unit: string
  color: string
  viewport: ViewportRange         // из useChartViewport
  onUserInteraction: (next: ViewportRange) => void
  isLoading: boolean
}
```

---

## 7. Отображение данных на графике

### 7.1 Тип серии

Всегда `LineSeries`. Никаких других типов. Поля `open_value, close_value, min_value, max_value` из API не используются в отображении.

### 7.2 Обработка данных перед рендером

```
raw points (from API)
  ↓
Фильтр: убрать ts=null, value=null, raw 65535/32767, reason contains "NA"
  ↓
Конвертация ts: ISO → Unix ms
  ↓
Сортировка по ts ASC (API уже отдаёт отсортированными — на всякий случай)
  ↓
НЕ делать interpolateToGrid (убрать совсем)
  ↓
Передать в lightweight-charts setData()
```

> **Решение: убрать interpolateToGrid.** Это была причина артефактов.
> lightweight-charts сам рисует линию между точками. Вставлять
> синтетические точки не нужно — библиотека интерполирует внутри.

### 7.3 Пробелы (gaps)

Null-bridge метод: для каждого гэпа из `gaps[]` вставить две `null`-точки —
lightweight-charts v5 автоматически разрывает линию на `null`.

```typescript
// При построении массива для setData():
// вставить {time: gap.fromMs / 1000, value: null}
// вставить {time: gap.toMs / 1000, value: null}
// Никакой раскраски фона не делать.
```

Никаких примитивов, никаких раскрашенных зон. Только разрыв линии.

### 7.4 Живая точка (livePoint)

Последнее значение из WebSocket (telemetry-store). Добавлять как отдельный
`update()` после `setData()`, чтобы не ждать следующего HTTP-запроса.
`first_data_at` фронтом не используется совсем.

```typescript
if (livePoint && livePoint.ts > lastPointTs) {
  series.update({ time: livePoint.ts / 1000, value: livePoint.value })
}
```

---

## 8. Управление viewport в lightweight-charts

### 8.1 Применение viewport из хука → в chart

```typescript
// Когда viewport (pendingRange) изменился извне (пресет, Live-тик):
chart.timeScale().setVisibleRange({
  from: viewport.from / 1000,  // lightweight-charts ожидает секунды
  to: viewport.to / 1000,
})
```

Использовать `useEffect` с `pendingRange` (с key-полем как тригером),
чтобы не применять каждый рендер.

### 8.2 Отслеживание взаимодействия пользователя

```typescript
// Подписаться на событие:
chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
  if (range === null) return
  const next: ViewportRange = {
    from: (range.from as number) * 1000,
    to: (range.to as number) * 1000,
  }
  onUserInteraction(next)
})
```

> **Критически важно: определение pan vs zoom.**
> Не использовать сравнение span'ов (это было причиной бага).
>
> Правильный подход:
> ```typescript
> // Отдельные события:
> chart.timeScale().subscribeVisibleLogicalRangeChange(...)  // любое движение
>
> // Для определения zoom vs pan — слушать mousewheel/pinch на canvas:
> // zoom: event.type === 'wheel' || pinch gesture
> // pan: mousedown + mousemove
>
> // Простейший вариант: всегда считать любое взаимодействие = manual режим.
> // В handleUserInteraction просто установить cameraMode = "manual".
> // Различать pan/zoom не нужно для текущего ТЗ.
> ```

### 8.3 Запрет scroll за пределы данных

```typescript
chart.applyOptions({
  timeScale: {
    rightBarStaysOnScroll: false,
    fixLeftEdge: false,   // не запрещать scroll влево
    fixRightEdge: false,  // не запрещать scroll вправо
    lockVisibleTimeRangeOnResize: true,
  }
})
```

Ограничение влево (до `firstDataAt`) реализовывать **не в chart**,
а в `useChartViewport` — при получении `onUserInteraction` проверять
и при необходимости мягко возвращать. Но лучше не ограничивать совсем
(как в TradingView — можно скроллить в пустоту).

---

## 9. Запросы к API

### 9.1 Выбор диапазона запроса

Запрашивать **чуть шире** видимого viewport:

```typescript
const marginRatio = 0.3  // 30% с каждой стороны
const spanMs = viewport.to - viewport.from
const queryFrom = viewport.from - spanMs * marginRatio
const queryTo = Math.min(Date.now(), viewport.to + spanMs * marginRatio)
```

### 9.2 Количество точек

```typescript
const targetPoints = Math.min(20000, Math.max(2000, window.innerWidth * 4))
```

### 9.3 Дебаунс запроса

При pan/zoom — дебаунс 300 мс перед изменением `queryFrom/queryTo`.
В Live-режиме — 120 мс.

### 9.4 Рефреш в Live-режиме

В Live-режиме: `refetchInterval: 30_000` в React Query.

---

## 10. Структура файлов

```
frontend/src/
├── components/equipment/history/
│   ├── HistoryChart.tsx          — lightweight-charts wrapper
│   ├── HistoryTab.tsx            — вкладка целиком (select + кнопки + chart)
│   ├── constants.ts              — RANGE_MS, REGISTER_OPTIONS, ...
│   ├── types.ts                  — ViewportRange, ChartPoint, GapZone, ...
│   └── utils.ts                  — чистые функции (alignToLive, clamp, ...)
├── hooks/
│   ├── use-history-query.ts      — React Query обёртка
│   └── use-chart-viewport.ts     — viewport state machine
```

---

## 11. Что НЕ делать (учтённые ошибки)

| Проблема | Причина | Решение |
|----------|---------|---------|
| pan вызывал zoom | `inferredInteraction` через сравнение span'ов + сброс `lastInteractionRef = null` | Не использовать span comparison. Любое взаимодействие = manual. |
| Серая/красная зоны | Не нужны — не паттерн биржевых графиков | Не реализовывать совсем. |
| `interpolateToGrid` — синтетические точки | Добавляет точки которых нет в данных, создаёт артефакты | Убрать совсем. null-bridge для разрыва линии. |
| `setData()` каждые 5 сек | Live-тик менял `pendingRange`, триггерил эффект | Сравнивать референс `data`. `setData` только при реальном изменении данных. |
| Определение viewport через `getVisibleRange()` | Зажимает viewport к краям данных | Использовать `getVisibleLogicalRange()` + msPerBar. |

---

## 12. Порядок реализации

1. `constants.ts` + `types.ts` — константы и типы
2. `utils.ts` — чистые функции (alignToLive, clampSpan, computeMaxSpan, ...)
3. `use-history-query.ts` — React Query хук
4. `use-chart-viewport.ts` — state machine Live/Manual
5. `HistoryChart.tsx` — lightweight-charts, только отрисовка
6. `HistoryTab.tsx` — собрать всё вместе
7. Подключить в `EquipmentPage.tsx`
