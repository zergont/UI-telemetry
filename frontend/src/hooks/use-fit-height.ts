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

import { useLayoutEffect, useRef } from "react";

/** Резерв под низ страницы: нижний отступ main + футер + запас (как у графика). */
const BOTTOM_GAP = 68;
const MIN_H = 200;

/**
 * Тянет элемент по высоте от его позиции до низа окна — область прокручивается
 * внутри, страница не растёт. Тот же паттерн, что автовысота графика (v4.25.0).
 *
 * Возвращает ref на скролл-контейнер; высота ставится через element.style.maxHeight.
 */
export function useFitHeight<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const refit = () => {
      // Абсолютная позиция (с учётом scrollY) — не зависит от прокрутки страницы
      const top = el.getBoundingClientRect().top + window.scrollY;
      const h = Math.max(MIN_H, Math.floor(window.innerHeight - top - BOTTOM_GAP));
      el.style.maxHeight = `${h}px`;
    };

    refit();
    window.addEventListener("resize", refit);
    // Пересчёт при смене вкладок/раскладки над таблицей
    const ro = new ResizeObserver(refit);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => {
      window.removeEventListener("resize", refit);
      ro.disconnect();
    };
  }, []);

  return ref;
}
