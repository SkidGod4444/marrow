import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-[60vh] w-full" />
    </div>
  );
}
