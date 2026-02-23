import { motion } from "framer-motion";

const STATUS_COLORS: Record<string, string> = {
  RUN: "#22c55e",
  STOP: "#6b7280",
  ALARM: "#ef4444",
  OFFLINE: "#f59e0b",
};

interface Props {
  status: string;
  onClick?: () => void;
}

export default function DguMarker({ status, onClick }: Props) {
  const color = STATUS_COLORS[status] || STATUS_COLORS.OFFLINE;

  return (
    <motion.div
      whileHover={{ scale: 1.2 }}
      onClick={onClick}
      className="cursor-pointer"
      style={{ width: 32, height: 32 }}
    >
      <svg width="32" height="32" viewBox="0 0 32 32">
        {(status === "RUN" || status === "ALARM") && (
          <circle cx="16" cy="16" r="14" fill={color} opacity="0.2">
            <animate
              attributeName="r"
              from="14"
              to="18"
              dur="2s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              from="0.3"
              to="0"
              dur="2s"
              repeatCount="indefinite"
            />
          </circle>
        )}
        <circle
          cx="16"
          cy="16"
          r="10"
          fill={color}
          stroke="white"
          strokeWidth="2"
        />
        <text
          x="16"
          y="20"
          textAnchor="middle"
          fill="white"
          fontSize="11"
          fontWeight="bold"
          fontFamily="system-ui, sans-serif"
        >
          G
        </text>
      </svg>
    </motion.div>
  );
}
