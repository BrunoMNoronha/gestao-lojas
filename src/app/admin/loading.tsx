import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto exibido durante a navegação entre módulos do painel
export default function AdminLoading() {
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="space-y-2 rounded-xl border p-4">
        <Skeleton className="h-8 w-full" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
