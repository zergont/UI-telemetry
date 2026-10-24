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

/**
 * Итоговый уровень: норма < предупреждение (аналитика) < внимание (панель) < авария (панель).
 * Уровень однозначно кодирует источник: предупреждение — только аналитика,
 * внимание/авария — только панель управления (CONTROLLER_FAULT).
 */
export type SeverityLevel = "норма" | "предупреждение" | "внимание" | "авария";
export type CokingRisk = "GREEN" | "YELLOW" | "RED";

/** Одна открытая тревога из /api/machines active_alarms. severity — англ. шкала. */
export interface ActiveAlarm {
  scenario: string;
  severity: "SHUTDOWN" | "WARNING" | "CAUTION" | "ALARM" | "INFO" | null;
  source: "panel" | "analytics" | null;
  /** для панельных — регистр/бит; у аналитических null */
  addr: number | null;
  bit: number | null;
  name: string | null;
  since: string | null;
  duration_sec: number;
  gate_suppressed: boolean;
}

export interface MachineAnalytics {
  router_sn: string;
  equip_type: string;
  panel_id: number;
  name: string;
  manufacturer: string | null;
  model: string | null;
  /** Состояние движка мониторинга cg-analytics (ПУСК/СТОП ОНЛАЙН), НЕ режим
   *  машины и не связь — меняется только вручную оператором cg-analytics,
   *  практически всегда "running". Для режима машины см. run_state,
   *  для свежести данных — data_stale и analytics_stale (см. analyticsLiveView).
   *  (было `status` до cg-analytics v4.9.53) */
  monitoring_status: "running" | "stopped";
  run_state: number | null;
  run_state_label: string | null;
  severity_level: SeverityLevel | null;
  /** Срабатывание аналитики проверено и отменено гейтом Claude */
  gate_checked: boolean;
  /** Сколько предупреждений обработал гейт за текущий сегмент */
  gate_events_count: number;
  gate_cancelled_count: number;
  status_text: string | null;
  /** Структурный статус: режим, время в режиме, текст главной тревоги */
  mode_label: string | null;
  time_in_mode_sec: number | null;
  alarm_text: string | null;
  status_updated: string | null;
  warning_analysis_md: string | null;
  coking_risk: CokingRisk | null;
  /** Открытые тревоги (per-fault): панельные по addr/bit, аналитические по сценарию */
  active_alarms: ActiveAlarm[] | null;
  /** Максимальный ts строки телеметрии, виденной аналитикой (ISO) */
  last_data_ts: string | null;
  /** Телеметрия аналитики устарела: статус/severity отражают last_data_ts, а не «сейчас».
   *  UI глушит ТОЛЬКО живой статус («норма от ИИ» без данных подрывает доверие);
   *  история и календарь ретроспективны и остаются доступными (cg-analytics v4.9.57+). */
  data_stale: boolean;
  /** Неудачная попытка пуска — открытый стоп-исход (cg-analytics v5.1.19) */
  attempt?: AttemptInfo | null;
  /** Выход из стопа ещё не подтверждён: «Работа — ждём подтверждения», не работа */
  attempt_pending?: boolean;
  // ── Надзор за движком (cg-analytics v5.1.24). Со старым бэкендом полей нет —
  //    поведение прежнее (analyticsLiveView считает их отсутствие за «всё хорошо»)
  /** Когда движок последний раз обновил живой анализ (ISO). Переживает
   *  перезапуск движка сторожем; null — наблюдение остановлено или движка не
   *  было с запуска сервиса (старт упал, нет привязки KB) */
  analytics_updated_at?: string | null;
  /** Сколько секунд живой анализ не обновлялся (считает сервер, по своим часам);
   *  null — наблюдение остановлено или движок ещё ни разу не отработал */
  analytics_lag_sec?: number | null;
  /** Аналитика не обновляется: живой статус не текущий по вине аналитики
   *  (движок завис, циклы падают, БД телеметрии недоступна), хотя панель может
   *  быть на связи. При true значение data_stale недостоверно: last_data_ts
   *  пишет сам движок */
  analytics_stale?: boolean;
  /** Сторож признал движок зависшим (нет продвижения, не завершился после
   *  отмены, исчерпан лимит перезапусков) или движка нет при running */
  engine_stalled?: boolean;
  /** Состояние движка (из него — engine_stalled); подробно — ui_api_guide §1.2 */
  engine_state?: EngineState;
  /** Сторож поднимет зависший или упавший движок сам. false — сторож выключен,
   *  машина вне надзора (needs_start — нужен ПУСК) или сторож сознательно не
   *  трогает движок. Текст «сторож перезапускает» — только при true */
  engine_auto_restart?: boolean;
  /** Почему движка нет или он не работает («ПУСК не выполнен: …», …) */
  engine_down_reason?: string | null;
  /** Перезапусков движка сторожем с запуска сервиса cg-analytics */
  engine_restarts?: number;
  /** Последний перезапуск движка сторожем */
  last_engine_restart?: EngineRestart | null;
}

/** Состояние движка cg-analytics (v5.1.24): running — работает; restarting —
 *  идёт ПУСК или перезапуск; stalled — завис; zombie — старая задача не
 *  завершилась после отмены; restart_limit — лимит перезапусков исчерпан;
 *  not_started — старт упал; needs_start — вне надзора, нужен ПУСК; stopped */
export type EngineState =
  | "running"
  | "restarting"
  | "stalled"
  | "zombie"
  | "restart_limit"
  | "not_started"
  | "needs_start"
  | "stopped";

/** Перезапуск движка сторожем cg-analytics (v5.1.24) */
export interface EngineRestart {
  ts: string | null;
  reason: string | null;
}

/** Почему живой статус скрыт: link — нет связи (панель offline или телеметрия
 *  аналитики устарела, data_stale); analytics — движок аналитики не обновляет
 *  живой анализ (analytics_stale), а панель на связи */
export type AnalyticsStaleKind = "link" | "analytics";

export interface AnalyticsLiveView {
  /** Живой статус — только когда ему можно верить, иначе undefined */
  analytics: MachineAnalytics | undefined;
  /** Аналитика машины есть, но живой статус скрыт */
  stale: boolean;
  staleKind: AnalyticsStaleKind;
  /** Метка для подписи «… с дд.мм, чч:мм»: last_data_ts при обрыве связи,
   *  analytics_updated_at — когда не обновляется аналитика. Только при stale
   *  (иначе null): при живом статусе метки сдвигаются каждые 15 с и обнуляли
   *  бы memo диалога-календаря */
  staleSince: string | null;
}

/**
 * Живой статус аналитики для карточки и страницы ДГУ. «Норма от ИИ» без
 * свежего анализа подрывает доверие, поэтому живой статус скрывается, а строка
 * говорит почему:
 *   панель offline                                → «Нет связи — данные на …»
 *   панель на связи, analytics_stale              → «Аналитика не обновляется N мин»
 *   панель на связи, data_stale, !analytics_stale → «Нет связи — данные на …»
 * История и календарь ретроспективны — вход в них остаётся всегда.
 */
export function analyticsLiveView(
  raw: MachineAnalytics | undefined,
  panelFresh: boolean,
): AnalyticsLiveView {
  const stuck = raw?.analytics_stale === true;
  const analytics =
    raw && panelFresh && !raw.data_stale && !stuck ? raw : undefined;
  if (!raw || analytics) {
    return { analytics, stale: false, staleKind: "link", staleSince: null };
  }
  // Панель offline — это обрыв связи, что бы ни говорила аналитика
  if (panelFresh && stuck) {
    return {
      analytics,
      stale: true,
      staleKind: "analytics",
      staleSince: raw.analytics_updated_at ?? null,
    };
  }
  return { analytics, stale: true, staleKind: "link", staleSince: raw.last_data_ts };
}

/** Неудачная попытка выхода из стопа (cg-analytics v5.1.16): плашка — стоп
 *  с подписью «Неудачная работа · Авария»; здесь — для цвета, подпись в run_state_label */
export interface AttemptInfo {
  outcome: "EMERGENCY" | "SIMPLE" | string;
  from_state: number | null;
}

/** Статус заключения: queued — в очереди, processing — пишется, skipped — не
 *  требуется (с cg-analytics v5.2.2). pending — старое имя queued */
export type ConclusionStatus =
  | "queued" | "pending" | "processing" | "done" | "error" | "skipped";

/** Заключение готовится: в очереди или пишется */
export function conclusionInProgress(status: ConclusionStatus | null | undefined): boolean {
  return status === "queued" || status === "pending" || status === "processing";
}

/**
 * Состояние машин из cg-analytics (через прокси дашборда).
 * Если сервис недоступен/отключён — data = undefined, UI прячет блоки аналитики.
 */
export function useAnalyticsMachines() {
  return useQuery({
    queryKey: ["analytics", "machines"],
    queryFn: () => apiFetch<MachineAnalytics[]>("/api/analytics/machines"),
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: false,
  });
}

// Актуальная шкала cg-analytics v4.8.9+: SHUTDOWN / WARNING / CAUTION.
// ALARM и INFO — легаси-значения старых сегментов, рендер их тоже понимает.
export type SegmentSeverity =
  | "SHUTDOWN" | "WARNING" | "CAUTION"
  | "ALARM" | "INFO"
  | null;

/** Готовность разбора совета по акту аварийного останова (cg-analytics v5.1.25,
 *  решение В-25.2): ready — разбор готов; pending — разбор в работе; failed —
 *  разбора не будет (терминальная отметка или вышли все сроки, 72 ч); none —
 *  акта нет */
export type IncidentAnalysisState = "ready" | "pending" | "failed" | "none";

/** Почему разбора совета нет (только при failed, cg-analytics v5.1.25):
 *  не заказывался / совет не ответил / снят на шлюзе / получен, но не записан */
export type IncidentAnalysisReason = "not_ordered" | "no_answer" | "removed" | "save_failed";

export interface SegmentOut {
  id: number;
  t_start: string | null;
  t_end: string | null;
  is_open: boolean;
  run_state: number | null;
  /** Вид стоп-сегмента: EMERGENCY — аварийный, SIMPLE — обычный, null — старая
   *  модель сегментации (cg-analytics v4.9.67+) */
  stop_kind?: string | null;
  run_state_label: string | null;
  duration_sec: number | null;
  cause_close: string | null;
  severity: SegmentSeverity;
  /** Операционные сутки сегмента (YYYY-MM-DD, граница daily_split_hour движка) */
  op_day: string | null;
  /** Срабатывание аналитики проверено и отменено гейтом Claude */
  gate_checked: boolean;
  /** Качество данных 0.0–1.0; null у сегментов до cg-analytics v4.9.57 */
  data_quality?: number | null;
  /** Закрытый сегмент без единой строки телеметрии (полный обрыв связи,
   *  data_quality == 0): рисуется как «нет связи», а не по run_state */
  no_data?: boolean;
  analytics_version: string | null;
  has_report: boolean;
  /** Есть заключение ИИ (модель). Факты без ИИ (плашка неудачного пуска) — false */
  has_claude: boolean;
  has_qwen?: boolean;
  /** Статус заключения и кто его пишет (cg-analytics v5.1.19) */
  conclusion_status?: ConclusionStatus | null;
  conclusion_by?: "ai" | "system" | null;
  /** Неудачная попытка пуска (стоп-исход) и неподтверждённый выход из стопа */
  attempt?: AttemptInfo | null;
  attempt_pending?: boolean;
  /** По сегменту построен акт аварийного останова (cg-analytics v4.9.70+).
   *  Сам акт тяжёлый — в календарь приходит только признак, тело в детали */
  has_incident?: boolean;
  /** Значок акта — по готовности разбора совета (cg-analytics v5.1.25): красный
   *  только при ready, серый «акт без разбора совета» при failed, при pending
   *  значка нет. null или поля нет (старый сервер, состояние не прочитано) —
   *  значок как раньше, по has_incident */
  incident_analysis?: IncidentAnalysisState | null;
  incident_analysis_reason?: IncidentAnalysisReason | null;
}

export interface SegmentAnalysis {
  status: ConclusionStatus | null;
  /** Кто написал: ai — модель, system — факты без ИИ (cg-analytics v5.1.19) */
  by?: "ai" | "system" | null;
  /** Почему не требуется (status = skipped, cg-analytics v5.2.2) */
  reason?: string | null;
  conclusion_md: string | null;
  humanized_md: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SegmentDetail extends SegmentOut {
  router_sn: string;
  equip_type: string;
  panel_id: number;
  report_md: string | null;
  /** Детерминированная сводка: вердикт, замечания, ключевые показатели */
  report_summary_md: string | null;
  analysis: SegmentAnalysis | null;
  /** Разбор гейта Claude в момент срабатывания — есть и у открытого сегмента */
  warning_analysis_md: string | null;
  /** История разборов гейта: смена состава тревог (сброс, кнопка останова)
   *  не затирает разбор исходной аварии (cg-analytics v4.9.36+) */
  warning_analyses: WarningAnalysis[] | null;
  /** Акт аварийного останова «Следователя»: вердикт характера и лента событий.
   *  Только у стоп-сегментов вида EMERGENCY (cg-analytics v4.9.70+) */
  incident_json?: StopIncident | null;
  /** Лента событий панели за окно стоп-сегмента — «кто что нажимал и сбрасывал,
   *  пока машина стояла». Только там, где акта нет: у аварийного стопа своя
   *  лента внутри incident_json (cg-analytics v4.9.76+) */
  chronology_json?: SegmentChronology | null;
  /** Цепочка суточного реза: у продолжения аварийного стопа своего акта нет,
   *  он лежит в голове, на которую указывает continued_from */
  continued_from?: number | null;
  continues_to?: number | null;
  status_text: string | null;
}

/** Событие ленты акта: смена состояния регистра (state) или фронт маски (fault) */
export interface StopIncidentEvent {
  ts: string | null;
  /** Конец события; null — на момент построения акта ещё активно */
  end: string | null;
  kind: "state" | "fault" | string;
  addr: number | null;
  bit: number | null;
  role: string | null;
  name: string | null;
  value: number | string | null;
  label: string | null;
  /** Сырая тяжесть из KB: shutdown / shutdown_cooldown / derate / warning / none */
  severity: string | null;
}

/** Вердикт характер-гейта. С v4.9.70 он не решает, строить ли акт (это делает
 *  вид стоп-сегмента), а едет в акт описанием характера останова. */
export interface StopIncidentCharacter {
  character: "immediate" | "controlled" | "unknown" | string;
  is_incident: boolean;
  confidence: "high" | "low" | string;
  immediate_votes: string[];
  controlled_votes: string[];
}

/** Голая лента событий сегмента, без вердикта: у стоянки разбирать нечего,
 *  важна сама последовательность действий панели и оператора. */
export interface SegmentChronology {
  kind: string;
  t_from: string | null;
  t_to: string | null;
  chronology: StopIncidentEvent[];
  version: string | null;
}

/** Маска, висевшая в момент останова: срез состояния, не событие ленты */
export interface StandingFault {
  name: string | null;
  severity: string | null;
  addr: number | null;
  bit: number | null;
  since: string | null;
  age_sec: number;
  cleared_at: string | null;
}

/** Свод по видам: одна строка на вид события за всё окно акта */
export interface EventSummaryRow {
  kind: "state" | "fault" | string;
  name: string | null;
  addr: number | null;
  bit: number | null;
  severity: string | null;
  count: number;
  first: string | null;
  last: string | null;
}

export interface StopIncident {
  kind: string;
  stop_ts: string | null;
  stop_kind: string | null;
  character: StopIncidentCharacter;
  /** Что висело в момент падения — маска могла подняться задолго до окна */
  standing?: StandingFault[] | null;
  /** Свод по видам покрывает ВСЁ окно, лента — только окрестность останова */
  summary?: EventSummaryRow[] | null;
  /** Сколько событий было в окне всего (лента показывает не все) */
  events_total?: number | null;
  window?: {
    from: string | null;
    to: string | null;
    /** normal_stop — окно от последнего штатного останова; fallback — эталона нет */
    baseline: string | null;
  } | null;
  chronology: StopIncidentEvent[];
  investigator_version: string | null;
  created_at: string | null;
}

export interface WarningAnalysis {
  t: string | null;
  fault_hash: string | null;
  alarm_text: string | null;
  md: string | null;
}

/**
 * Сегменты машины за календарный месяц (для диалога-календаря).
 * router_sn/equip_type/panel_id — из ответа cg-analytics (/machines),
 * а не из телеметрии дашборда: equip_type может различаться.
 */
export function useMachineSegments(
  machine: Pick<MachineAnalytics, "router_sn" | "equip_type" | "panel_id"> | undefined,
  year: number,
  month: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      "analytics",
      "segments",
      machine?.router_sn,
      machine?.equip_type,
      machine?.panel_id,
      year,
      month,
    ],
    queryFn: () =>
      apiFetch<SegmentOut[]>(
        `/api/analytics/machine/${machine!.router_sn}/${machine!.equip_type}/${machine!.panel_id}/segments?year=${year}&month=${month}`,
      ),
    enabled: enabled && !!machine,
    staleTime: 30_000,
    retry: false,
  });
}

/** Детальный отчёт по сегменту; поллинг 10 с, пока заключение ИИ в очереди/обработке. */
export function useSegmentDetail(segId: number | null) {
  return useQuery({
    queryKey: ["analytics", "segment", segId],
    queryFn: () => apiFetch<SegmentDetail>(`/api/analytics/segment/${segId}`),
    enabled: segId != null,
    retry: false,
    refetchInterval: (query) =>
      conclusionInProgress(query.state.data?.analysis?.status) ? 10_000 : false,
  });
}

/**
 * Аналитика конкретной машины.
 * equip_type в cg-analytics задаётся при создании наблюдения и может не совпадать
 * со значением из телеметрии — поэтому фолбэк по router_sn + panel_id.
 */
export function useMachineAnalytics(
  routerSn: string,
  equipType: string,
  panelId: number | string,
): MachineAnalytics | undefined {
  const { data } = useAnalyticsMachines();
  if (!data) return undefined;
  const pid = Number(panelId);
  return (
    data.find(
      (m) =>
        m.router_sn === routerSn &&
        m.equip_type === equipType &&
        m.panel_id === pid,
    ) ?? data.find((m) => m.router_sn === routerSn && m.panel_id === pid)
  );
}
