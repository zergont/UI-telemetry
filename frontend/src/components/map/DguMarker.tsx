import { motion } from "framer-motion";
import { getStatusMeta } from "@/lib/status";

interface Props {
  status: string;
  onClick?: () => void;
}

export default function DguMarker({ status, onClick }: Props) {
  const meta = getStatusMeta(status);
  const color = meta.markerColor;

  return (
    <motion.div
      whileHover={{ scale: 1.2 }}
      onClick={onClick}
      className="cursor-pointer"
      style={{ width: 32, height: 32 }}
    >
      <svg width="32" height="32" viewBox="0 0 32 32">
        {meta.markerPulse && (
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
