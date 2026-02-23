import { useObjects } from "@/hooks/use-objects";
import ObjectsMap from "@/components/map/ObjectsMap";
import ObjectsTable from "@/components/objects/ObjectsTable";

export default function StartPage() {
  const { data: objects, isLoading } = useObjects();

  return (
    <div className="space-y-6">
      <div className="h-[500px] rounded-xl overflow-hidden border bg-card">
        <ObjectsMap objects={objects ?? []} isLoading={isLoading} />
      </div>
      <ObjectsTable objects={objects ?? []} isLoading={isLoading} />
    </div>
  );
}
