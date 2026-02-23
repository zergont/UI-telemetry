import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatMetric } from "@/lib/format";

interface Props {
  label: string;
  value: number | null | undefined;
  unit: string;
  decimals?: number;
  reason?: string | null;
}

export default function MetricDisplay({
  label,
  value,
  unit,
  decimals = 1,
  reason,
}: Props) {
  const { display, tooltip } = formatMetric(value, unit, decimals, reason);

  const content = (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums tracking-tight">
        {display}
      </p>
    </div>
  );

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="cursor-help">{content}</div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}
