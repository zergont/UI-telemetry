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

import type { SeverityLevel } from "@/hooks/use-analytics";

interface Props {
  severity: SeverityLevel;
  className?: string;
}

/** Лицо робота по ступени серьёзности: норма — улыбка, авария — испуг */
const FACES: Record<SeverityLevel, React.ReactNode> = {
  норма: (
    <>
      <path d="M9 12.5v2" />
      <path d="M15 12.5v2" />
      <path d="M9 16.5q3 2.2 6 0" />
    </>
  ),
  внимание: (
    <>
      <path d="M9 12.5v2" />
      <path d="M15 12.5v2" />
      <path d="M9.5 17h5" />
    </>
  ),
  предупреждение: (
    <>
      <path d="M9 12.5v2" />
      <path d="M15 12.5v2" />
      <path d="M9 17.5q3 -2.2 6 0" />
    </>
  ),
  авария: (
    <>
      <circle cx="9" cy="13.5" r="1" />
      <circle cx="15" cy="13.5" r="1" />
      <circle cx="12" cy="17" r="1.5" />
    </>
  ),
};

/** Голова робота в стиле lucide (stroke = currentColor), мимика по severity */
export default function RobotMoodIcon({ severity, className }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 8V5" />
      <circle cx="12" cy="3.5" r="0.5" />
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      {FACES[severity] ?? FACES["норма"]}
    </svg>
  );
}
