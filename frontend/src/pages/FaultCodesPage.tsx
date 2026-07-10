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

import { useNavigate, useParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTheme } from "@/hooks/use-theme";

const PANELS = [
  {
    id: "3300",
    label: "PCC 3300",
    file: "/pcc3300_fault_codes.html",
    title: "Справочник кодов неисправностей PowerCommand PCC 3300",
  },
  {
    id: "3100",
    label: "PCC 3100 PCCP",
    file: "/pcc3100_fault_codes.html",
    title: "Справочник кодов неисправностей PowerCommand PCC 3100 PCCP",
  },
] as const;

export default function FaultCodesPage() {
  const { panel } = useParams();
  const navigate = useNavigate();
  const { theme } = useTheme();

  const current = PANELS.find((p) => p.id === panel) ?? PANELS[0];

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={current.id}
        onValueChange={(v) =>
          navigate(`/reference/fault-codes/${v}`, { replace: true })
        }
      >
        <TabsList>
          {PANELS.map((p) => (
            <TabsTrigger key={p.id} value={p.id}>
              {p.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <iframe
        key={current.id}
        src={`${current.file}?theme=${theme}`}
        title={current.title}
        style={{
          width: "100%",
          height: "calc(100vh - 12.5rem)",
          border: "none",
          borderRadius: "8px",
          display: "block",
        }}
      />
    </div>
  );
}
