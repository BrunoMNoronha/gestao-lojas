import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { CatalogAddButton } from "@/components/catalog-add-button";
import { CatalogImage } from "@/components/catalog-image";
import type { CatalogProduct } from "@/lib/catalog";
import { formatCurrency } from "@/lib/utils";

export function CatalogAvailabilityBadge({ available }: { available: boolean }) {
  return (
    <Badge variant={available ? "success" : "secondary"}>
      {available ? "Disponível" : "Indisponível"}
    </Badge>
  );
}

// Cartão da grade do catálogo: só campos públicos do produto
export function CatalogProductCard({ product }: { product: CatalogProduct }) {
  const href = `/catalogo/${product.id}`;
  return (
    <li className="bg-card flex min-w-0 flex-col overflow-hidden rounded-xl border">
      <Link href={href} tabIndex={-1} aria-hidden className="block">
        <CatalogImage src={product.imageUrl} alt={product.name} className="aspect-square w-full" />
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-3">
        {product.categoryName && (
          <span className="text-muted-foreground truncate text-xs">{product.categoryName}</span>
        )}
        <Link href={href} className="line-clamp-2 text-sm leading-snug font-medium hover:underline">
          {product.name}
        </Link>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-1 pt-2">
          <p>
            <span className="font-semibold">{formatCurrency(product.price)}</span>
            <span className="text-muted-foreground text-xs"> / {product.unit}</span>
          </p>
          <CatalogAvailabilityBadge available={product.available} />
        </div>
        <CatalogAddButton
          className="mt-2"
          product={{
            id: product.id,
            name: product.name,
            price: product.price,
            unit: product.unit,
            imageUrl: product.imageUrl,
            available: product.available,
          }}
        />
      </div>
    </li>
  );
}
