"use client";
import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getProductOptions, getCustomerOptions } from "@/actions/browse";
import type { ProductItem } from "@/actions/products";

type Named = { id: string; name: string };
function Lookup<T extends Named>({
  label,
  value,
  selected,
  load,
  onSelect,
  emptyLabel = "Nenhum",
}: {
  label: string;
  value: string;
  selected?: Named | null;
  load: (q: string) => Promise<T[]>;
  onSelect: (item: T | null) => void;
  emptyLabel?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ items: T[]; error: boolean; q: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const timer = setTimeout(() => {
      void load(q)
        .then((items) => {
          if (active) setState({ items, error: false, q });
        })
        .catch(() => {
          if (active) setState({ items: [], error: true, q });
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q, open, load]);
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {selected?.id === value ? selected.name : value ? "Selecionado" : emptyLabel}
      </Button>
      {open && (
        <div className="rounded-md border p-2">
          <Input
            autoFocus
            aria-label={`Buscar: ${label}`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Digite para buscar..."
          />
          <div className="max-h-52 overflow-y-auto" role="listbox" aria-label={label}>
            <button
              type="button"
              role="option"
              aria-selected={!value}
              className="block w-full p-2 text-left text-sm"
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
            >
              {emptyLabel}
            </button>
            {state?.q === q &&
              state.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={value === item.id}
                  className="hover:bg-accent block w-full p-2 text-left text-sm"
                  onClick={() => {
                    onSelect(item);
                    setOpen(false);
                  }}
                >
                  {item.name}
                </button>
              ))}
          </div>
          <p className="text-muted-foreground text-xs" role="status">
            {state?.q !== q
              ? "Buscando..."
              : state.error
                ? "Falha na busca. Tente novamente."
                : state.items.length === 0
                  ? "Nenhum resultado."
                  : "Até 50 resultados. Refine a busca se necessário."}
          </p>
        </div>
      )}
    </div>
  );
}
export function ProductLookup({
  boxId,
  ...props
}: {
  label: string;
  value: string;
  selected?: Named | null;
  onSelect: (item: ProductItem | null) => void;
  emptyLabel?: string;
  boxId?: string;
}) {
  const load = useCallback((q: string) => getProductOptions(q, undefined, boxId), [boxId]);
  return <Lookup {...props} load={load} />;
}
export function CustomerLookup(props: {
  label: string;
  value: string;
  selected?: Named | null;
  onSelect: (item: Awaited<ReturnType<typeof getCustomerOptions>>[number] | null) => void;
  emptyLabel?: string;
}) {
  return <Lookup {...props} load={getCustomerOptions} />;
}
