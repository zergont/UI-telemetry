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

import { PANEL_BOX } from "./registers";

interface Lamp {
  label: string;
  /** css-классы зажжённой лампы; null — погашена */
  on: string | null;
  pulse?: boolean;
  /** подпись зажжённой лампы подсвечивается этим классом */
  labelOn?: string;
}

interface Props {
  /** 40010 Switch Position: 0 Откл, 1 Авто, 2 Ручной */
  modeRaw: number | null;
  /** 40011 Run Sequence State: 0 Стоп … 6 */
  stateRaw: number | null;
  /** 40013 Тип неисправности: 1-2 внимание, 3-4 авария */
  faultRaw: number | null;
  size?: "md" | "sm";
}

/** Светодиодный блок панели — только от регистров контроллера */
export default function LedPanel({ modeRaw, stateRaw, faultRaw, size = "md" }: Props) {
  const running = stateRaw != null && stateRaw >= 1 && stateRaw <= 6;

  const modeLamp: Lamp =
    modeRaw === 1
      ? { label: "АВТО", on: "bg-blue-400 outline-blue-400/25", labelOn: "text-blue-300" }
      : modeRaw === 2
        ? { label: "РУЧНОЙ", on: "bg-amber-400 outline-amber-400/25", labelOn: "text-amber-300" }
        : { label: "РЕЖИМ", on: null };

  const lamps: Lamp[] = [
    {
      label: "РАБОТА",
      on: running ? "bg-green-500 outline-green-500/25" : null,
      pulse: running,
      labelOn: "text-green-400",
    },
    modeLamp,
    {
      label: "ВНИМАНИЕ",
      on:
        faultRaw === 1 || faultRaw === 2
          ? "bg-orange-400 outline-orange-400/25"
          : null,
      pulse: true,
      labelOn: "text-orange-300",
    },
    {
      label: "АВАРИЯ",
      on:
        faultRaw === 3 || faultRaw === 4
          ? "bg-red-500 outline-red-500/30"
          : null,
      pulse: true,
      labelOn: "text-red-400",
    },
  ];

  const dot = size === "md" ? "h-2 w-2" : "h-[7px] w-[7px]";
  const label = size === "md" ? "text-[8px]" : "text-[7px]";
  const gap = size === "md" ? "gap-3 px-2.5 py-1.5" : "gap-2.5 px-2 py-1";

  return (
    <div className={`flex ${gap} ${PANEL_BOX}`}>
      {lamps.map((lamp) => (
        <span key={lamp.label} className="text-center">
          <span
            className={`mx-auto block rounded-full ${dot} ${
              lamp.on
                ? `${lamp.on} outline outline-[3px] ${lamp.pulse ? "animate-pulse" : ""}`
                : "bg-foreground/10"
            }`}
          />
          <span
            className={`mt-1 block ${label} tracking-[0.08em] ${
              lamp.on ? lamp.labelOn ?? "text-muted-foreground" : "text-muted-foreground/80"
            }`}
          >
            {lamp.label}
          </span>
        </span>
      ))}
    </div>
  );
}
