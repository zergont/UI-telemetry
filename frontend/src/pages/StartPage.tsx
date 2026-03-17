import { lazy, Suspense, useState } from "react";
import { useObjects } from "@/hooks/use-objects";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import ObjectsTable from "@/components/objects/ObjectsTable";

const ObjectsMap = lazy(() => import("@/components/map/ObjectsMap"));

export default function StartPage() {
  const { data: objects, isLoading } = useObjects();
  const [focusedSn, setFocusedSn] = useState<string | null>(null);
  const [divingSn, setDivingSn] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="h-[500px] rounded-xl overflow-hidden border bg-card">
        <ErrorBoundary>
          <Suspense fallback={<Skeleton className="h-full w-full" />}>
            <ObjectsMap
              objects={objects ?? []}
              isLoading={isLoading}
              focusedSn={focusedSn}
              onFocusChange={setFocusedSn}
              divingSn={divingSn}
              onDive={setDivingSn}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
      <ObjectsTable
        objects={objects ?? []}
        isLoading={isLoading}
        focusedSn={focusedSn}
        onObjectClick={setFocusedSn}
        onObjectDive={setDivingSn}
      />
    </div>
  );
}
