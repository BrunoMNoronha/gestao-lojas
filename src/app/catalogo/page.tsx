import { connection } from "next/server";
import Link from "next/link";
import { ChevronLeft, ChevronRight, SearchX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { CatalogFilters } from "@/components/catalog-filters";
import { CatalogProductCard } from "@/components/catalog-product-card";
import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { EmptyState } from "@/components/empty-state";
import { getCatalogCategories, getCatalogProducts, getCatalogStore } from "@/lib/catalog";
import { catalogHref, parseCatalogFilters } from "@/lib/catalog-shared";
import { cn } from "@/lib/utils";

export default async function CatalogPage({ searchParams }: PageProps<"/catalogo">) {
  // Dados da loja vêm do banco: renderiza a cada requisição em vez de prerenderizar no build
  await connection();
  const store = await getCatalogStore();
  if (!store) return <CatalogUnavailable reason="error" />;
  if (!store.enabled) return <CatalogUnavailable reason="disabled" />;

  const filters = parseCatalogFilters(await searchParams);
  const [result, categories] = await Promise.all([
    getCatalogProducts(filters),
    getCatalogCategories(),
  ]);
  if (!result) return <CatalogUnavailable reason="error" />;

  const { products, total, page, pageCount } = result;
  const current = { ...filters, page };
  const filtered = !!(filters.q || filters.category || filters.available);
  const pageLinkClass = (disabled: boolean) =>
    cn(
      buttonVariants({ variant: "outline", size: "lg" }),
      disabled && "pointer-events-none opacity-50",
    );

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Catálogo</h1>
        <p className="text-muted-foreground text-sm">
          Monte seu carrinho e envie o pedido pelo WhatsApp da loja.
        </p>
      </div>

      <CatalogFilters key={filters.q} filters={current} categories={categories} />

      {products.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Nenhum produto encontrado"
          description={
            filtered
              ? "Tente outra busca ou remova os filtros."
              : "Ainda não há produtos neste catálogo."
          }
        />
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            {total} {total === 1 ? "produto" : "produtos"}
          </p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <CatalogProductCard key={product.id} product={product} />
            ))}
          </ul>
          {pageCount > 1 && (
            <nav aria-label="Paginação" className="flex items-center justify-center gap-2 pt-2">
              <Link
                href={catalogHref(current, { page: page - 1 })}
                aria-disabled={page <= 1}
                tabIndex={page <= 1 ? -1 : undefined}
                className={pageLinkClass(page <= 1)}
              >
                <ChevronLeft /> Anterior
              </Link>
              <span className="text-muted-foreground px-1 text-sm whitespace-nowrap">
                {page} de {pageCount}
              </span>
              <Link
                href={catalogHref(current, { page: page + 1 })}
                aria-disabled={page >= pageCount}
                tabIndex={page >= pageCount ? -1 : undefined}
                className={pageLinkClass(page >= pageCount)}
              >
                Próxima <ChevronRight />
              </Link>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
