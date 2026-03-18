import { Card, CardContent } from "@/components/ui/card";
import StatusBadge from "@/components/equipment/StatusBadge";

interface OverviewTabProps {
  status: string;
  installedPower: number | null;
  currentLoad: number | null;
}

export default function OverviewTab({
  status,
  installedPower,
  currentLoad,
}: OverviewTabProps) {
  const loadPercent =
    installedPower && currentLoad
      ? Math.round((currentLoad / installedPower) * 100)
      : null;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Состояние</p>
          <div className="mt-2">
            <StatusBadge status={status} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Загрузка</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {loadPercent != null ? `${loadPercent}%` : "\u2014"}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Мощность</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {currentLoad != null ? `${currentLoad.toFixed(1)} кВт` : "\u2014"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
