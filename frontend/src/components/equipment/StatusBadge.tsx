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

import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { getStatusMeta } from "@/lib/status";

export default function StatusBadge({ status }: { status: string }) {
  const config = getStatusMeta(status);

  return (
    <motion.div
      key={status}
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 15 }}
    >
      <Badge variant="outline" className={config.badgeClassName}>
        {config.dotClassName && config.markerPulse && (
          <span className={`mr-1.5 inline-block h-2 w-2 rounded-full animate-pulse ${config.dotClassName}`} />
        )}
        {config.label}
      </Badge>
    </motion.div>
  );
}
