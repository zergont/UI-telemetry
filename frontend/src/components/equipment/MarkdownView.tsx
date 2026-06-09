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

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  children: string;
}

/** Рендер Markdown-отчётов cg-analytics (стили — .md-body в index.css). */
export default function MarkdownView({ children }: Props) {
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
