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

import { loadZoneColor } from "./registers";

/** Длина дуги r=80: π·80 */
const ARC = 251.33;
const ARC_PATH = "M20 100 A80 80 0 0 1 180 100";

interface Props {
  loadKw: number | null;
  ratedKw: number | null;
  /** ширина в px */
  width?: number;
}

/**
 * Полукруглая шкала нагрузки с зонами:
 * <30% жёлтая (недогруз), 30–80 зелёная, 80–90 янтарная, >90 красная.
 */
export default function LoadGauge({ loadKw, ratedKw, width = 158 }: Props) {
  const pct =
    loadKw != null && ratedKw != null && ratedKw > 0
      ? Math.max(0, (loadKw / ratedKw) * 100)
      : null;
  const frac = pct != null ? Math.min(pct, 100) / 100 : 0;
  const color = pct != null ? loadZoneColor(pct) : "#10b981";

  return (
    <div className="relative" style={{ width }}>
      <svg viewBox="0 0 200 116" width={width}>
        <path
          d={ARC_PATH}
          fill="none"
          strokeWidth="13"
          strokeLinecap="round"
          className="stroke-muted dark:stroke-white/10"
        />
        {/* Зонные риски: недогруз, перегруз, опасно */}
        <path
          d={ARC_PATH} fill="none" stroke="#eab308" strokeWidth="3"
          strokeLinecap="round" strokeDasharray={`${ARC * 0.3} ${ARC * 0.7}`}
        />
        <path
          d={ARC_PATH} fill="none" stroke="#f59e0b" strokeWidth="3"
          strokeLinecap="round" strokeDasharray={`${ARC * 0.1} ${ARC * 0.9}`}
          strokeDashoffset={-ARC * 0.8}
        />
        <path
          d={ARC_PATH} fill="none" stroke="#ef4444" strokeWidth="3"
          strokeLinecap="round" strokeDasharray={`${ARC * 0.1} ${ARC * 0.9}`}
          strokeDashoffset={-ARC * 0.9}
        />
        {/* Стрелка-дуга текущей нагрузки */}
        {frac > 0.005 && (
          <path
            d={ARC_PATH}
            fill="none"
            stroke={color}
            strokeWidth="13"
            strokeLinecap="round"
            strokeDasharray={`${ARC * frac} ${ARC}`}
            style={{ transition: "stroke-dasharray 0.6s ease, stroke 0.6s ease" }}
          />
        )}
        <text
          x="100" y="74" textAnchor="middle"
          className="fill-foreground"
          fontSize="26" fontWeight="600"
        >
          {loadKw != null ? Math.round(loadKw) : "—"}
        </text>
        <text
          x="100" y="92" textAnchor="middle"
          className="fill-muted-foreground" fontSize="11"
        >
          кВт{pct != null ? ` · ${Math.round(pct)}%` : ""}
        </text>
        <text x="20" y="114" textAnchor="middle" className="fill-muted-foreground/60" fontSize="9">
          0
        </text>
        <text x="180" y="114" textAnchor="middle" className="fill-muted-foreground/60" fontSize="9">
          {ratedKw != null ? Math.round(ratedKw) : ""}
        </text>
      </svg>
      <p className="mt-0.5 text-center text-[8px] tracking-[0.14em] text-muted-foreground">
        НАГРУЗКА
      </p>
    </div>
  );
}
