"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/option-select";
import {
  CATALOG_SORTS,
  CATALOG_SORT_LABELS,
  catalogHref,
  type CatalogFilters as Filters,
  type CatalogSort,
} from "@/lib/catalog-shared";

interface CatalogFiltersProps {
  filters: Filters;
  categories: { id: string; name: string }[];
}

// Busca, categoria, "somente disponíveis" e ordenação do catálogo. Cada mudança vira uma URL nova
// (compartilhável) e volta para a primeira página.
export function CatalogFilters({ filters, categories }: CatalogFiltersProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q);

  const apply = (changes: Partial<Filters>) => {
    startTransition(() => router.push(catalogHref(filters, { ...changes, page: 1 })));
  };

  const hasFilters = !!(
    filters.q ||
    filters.category ||
    filters.available ||
    filters.sort !== "nome"
  );

  return (
    <div className="bg-card space-y-3 rounded-xl border p-3 sm:p-4">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ q: query.trim().slice(0, 100) });
        }}
      >
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="search"
            aria-label="Buscar produto por nome ou código"
            placeholder="Buscar por nome ou código"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={100}
            className="h-9 pl-9"
          />
        </div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Search />}
          <span className="sr-only sm:not-sr-only">Buscar</span>
        </Button>
      </form>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
        <OptionSelect
          aria-label="Filtrar por categoria"
          value={filters.category}
          onValueChange={(category) => apply({ category })}
          options={[
            { value: "", label: "Todas as categorias" },
            ...categories.map((category) => ({ value: category.id, label: category.name })),
          ]}
        />
        <OptionSelect
          aria-label="Ordenar produtos"
          value={filters.sort}
          onValueChange={(sort) => apply({ sort: sort as CatalogSort })}
          options={CATALOG_SORTS.map((sort) => ({ value: sort, label: CATALOG_SORT_LABELS[sort] }))}
        />
        <div className="flex items-center gap-2">
          <Checkbox
            id="catalogo-somente-disponiveis"
            checked={filters.available}
            onCheckedChange={(checked) => apply({ available: checked })}
          />
          <Label htmlFor="catalogo-somente-disponiveis" className="text-sm font-normal">
            Somente disponíveis
          </Label>
        </div>
      </div>

      {hasFilters && (
        <Link
          href="/catalogo"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
          onClick={() => setQuery("")}
        >
          <X className="size-3" aria-hidden /> Limpar filtros
        </Link>
      )}
    </div>
  );
}
