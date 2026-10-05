"use client";
import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PAGE_SIZE, type PageInfo } from "@/lib/pagination";

export function useListQuery(key = "q", fallback = "") {
  const [filters, setFilters] = useListFilters({ [key]: fallback });
  return [filters[key], (value: string) => setFilters({ [key]: value })] as const;
}
export function ListPagination({ page, total }: PageInfo) {
  const params = useSearchParams();
  const path = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  function go(value: number) {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(value));
    startTransition(() => router.replace(`${path}?${next}`, { scroll: false }));
  }
  return (
    <nav aria-label="Paginação" className="flex items-center justify-between gap-3 py-3 text-sm">
      <span aria-live="polite">
        {total} registros · Página {page} de {pages}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={pending || page <= 1}
          onClick={() => go(Math.min(page - 1, pages))}
        >
          Anterior
        </Button>
        <Button variant="outline" disabled={pending || page >= pages} onClick={() => go(page + 1)}>
          Próxima
        </Button>
      </div>
    </nav>
  );
}

// Uma navegação contém todos os filtros, inclusive quando a câmera muda três campos juntos.
export function useListFilters<T extends Record<string, string>>(defaults: T) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const actual = Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [key, params.get(key) ?? fallback]),
  ) as T;
  const signature = JSON.stringify(actual);
  const [draft, setDraft] = useState({ signature, value: actual, pending: [] as string[] });
  const ownNavigation = draft.pending.includes(signature);
  if (draft.signature !== signature) {
    setDraft({
      ...draft,
      signature,
      value: ownNavigation ? draft.value : actual,
      pending: draft.pending.filter((item) => item !== signature),
    });
  }
  const value = draft.signature === signature || ownNavigation ? draft.value : actual;
  const serialized = JSON.stringify(value);
  const search = params.toString();
  useEffect(() => {
    if (serialized === signature) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(search);
      for (const [key, entry] of Object.entries(JSON.parse(serialized) as Record<string, string>)) {
        if (entry) next.set(key, entry);
        else next.delete(key);
      }
      next.delete("page");
      setDraft((previous) => ({
        ...previous,
        pending: [...previous.pending, serialized].slice(-10),
      }));
      router.replace(`${path}?${next}`, { scroll: false });
    }, 300);
    return () => clearTimeout(timer);
  }, [serialized, signature, search, path, router]);
  return [
    value,
    (patch: Partial<T>) =>
      setDraft((previous) => ({
        ...previous,
        signature,
        value: { ...previous.value, ...patch },
      })),
  ] as const;
}
