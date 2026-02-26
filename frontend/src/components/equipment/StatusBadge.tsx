import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  RUN: {
    label: "РАБОТА",
    className:
      "bg-green-500/15 text-green-500 border-green-500/20 hover:bg-green-500/25",
  },
  STOP: {
    label: "СТОП",
    className:
      "bg-gray-500/15 text-gray-400 border-gray-500/20 hover:bg-gray-500/25",
  },
  ALARM: {
    label: "АВАРИЯ",
    className:
      "bg-red-500/15 text-red-500 border-red-500/20 hover:bg-red-500/25",
  },
  ONLINE: {
    label: "НА СВЯЗИ",
    className:
      "bg-blue-500/15 text-blue-500 border-blue-500/20 hover:bg-blue-500/25",
  },
  DELAY: {
    label: "ЗАДЕРЖКА",
    className:
      "bg-amber-500/15 text-amber-500 border-amber-500/20 hover:bg-amber-500/25",
  },
  OFFLINE: {
    label: "НЕТ СВЯЗИ",
    className:
      "bg-red-500/15 text-red-400 border-red-500/20 hover:bg-red-500/25",
  },
};

export default function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.OFFLINE;

  return (
    <motion.div
      key={status}
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 15 }}
    >
      <Badge variant="outline" className={config.className}>
        {status === "RUN" && (
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" />
        )}
        {status === "ALARM" && (
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        )}
        {status === "ONLINE" && (
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
        )}
        {config.label}
      </Badge>
    </motion.div>
  );
}
