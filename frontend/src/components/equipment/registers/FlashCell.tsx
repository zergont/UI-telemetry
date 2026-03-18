import { useEffect, useRef, useState, type ReactNode } from "react";
import { TableCell } from "@/components/ui/table";

interface FlashCellProps {
  value: unknown;
  className?: string;
  children: ReactNode;
}

export default function FlashCell({
  value,
  className = "",
  children,
}: FlashCellProps) {
  const prevRef = useRef(value);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (prevRef.current !== value) {
      prevRef.current = value;
      const frame = requestAnimationFrame(() => setFlash(true));
      const timer = window.setTimeout(() => setFlash(false), 1200);
      return () => {
        cancelAnimationFrame(frame);
        window.clearTimeout(timer);
      };
    }
  }, [value]);

  return (
    <TableCell
      className={`${className} transition-colors duration-1000 ${
        flash ? "bg-primary/15" : ""
      }`}
    >
      {children}
    </TableCell>
  );
}
