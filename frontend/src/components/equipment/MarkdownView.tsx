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

import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  children: string;
  /** Заменить эмодзи тяжести на кружки палитры интерфейса.
   *
   *  В отчётах cg-analytics тяжесть помечена эмодзи (_SEVERITY_EMOJI в
   *  analytics/serializer.py) — так её видно и в сыром Markdown, и в промпте
   *  модели. Но цвет эмодзи задаёт шрифт, и рядом с плашками он выглядит
   *  чужим: 🔴 светлее и теплее нашего red-600.
   *
   *  Включать только для КОРОТКИХ текстов — сводки, разбора. На полном
   *  отчёте в сотни килобайт обход всех текстовых узлов не окупается. */
  colorizeSeverity?: boolean;
}

/** Эмодзи тяжести → цвет кружка. Шкала та же, что у плашек календаря. */
const SEVERITY_DOT: Record<string, string> = {
  "🔴": "bg-red-600",
  "🟠": "bg-orange-500",
  "🟡": "bg-yellow-400",
  "🔵": "bg-sky-500",
};
const SEVERITY_RE = /([🔴🟠🟡🔵])/u;

/** Разбить текстовые узлы по эмодзи тяжести, подставив свои кружки. */
function colorize(node: ReactNode, keyBase = "s"): ReactNode {
  if (typeof node === "string") {
    if (!SEVERITY_RE.test(node)) return node;
    return node.split(SEVERITY_RE).map((part, i) =>
      SEVERITY_DOT[part] ? (
        <span
          key={`${keyBase}-${i}`}
          className={`mr-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full align-[-1px] ${SEVERITY_DOT[part]}`}
        />
      ) : (
        part
      ),
    );
  }
  if (Array.isArray(node)) {
    return node.map((n, i) => (
      <span key={`${keyBase}-w${i}`} className="contents">
        {colorize(n, `${keyBase}-${i}`)}
      </span>
    ));
  }
  return node;
}

const COLORIZED: Components = {
  p: ({ children }) => <p>{colorize(children, "p")}</p>,
  li: ({ children }) => <li>{colorize(children, "li")}</li>,
  td: ({ children }) => <td>{colorize(children, "td")}</td>,
  strong: ({ children }) => <strong>{colorize(children, "b")}</strong>,
};

/** Рендер Markdown-отчётов cg-analytics (стили — .md-body в index.css).
 *
 *  memo обязателен: отчёты доходят до сотен КБ, а react-markdown парсит строку
 *  заново на каждый рендер. Пропс — строка, значит сравнение идёт по значению
 *  и отчёт переживает любой ре-рендер родителя с теми же данными. */
export default memo(function MarkdownView({ children, colorizeSeverity }: Props) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={colorizeSeverity ? COLORIZED : undefined}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
