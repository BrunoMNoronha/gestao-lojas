import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { CatalogAddButton } from "@/components/catalog-add-button";
import { CatalogImage } from "@/components/catalog-image";
import { CatalogAvailabilityBadge } from "@/components/catalog-product-card";
import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { getCatalogProduct, getCatalogStore } from "@/lib/catalog";
import { formatCurrency } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/catalogo/[id]">): Promise<Metadata> {
  const store = await getCatalogStore();
  if (!store?.enabled) return { title: "Catálogo indisponível" };
  const product = await getCatalogProduct((await params).id);
  if (!product) return { title: "Produto não encontrado" };
  const description =
    product.description?.slice(0, 160) ||
    `${product.name} por ${formatCurrency(product.price)} / ${product.unit} em ${store.name}.`;
  return {
    title: product.name,
    description,
    openGraph: {
      type: "website",
      locale: "pt_BR",
      siteName: store.name,
      title: product.name,
      description,
      images: product.imageUrl ? [{ url: product.imageUrl, alt: product.name }] : undefined,
    },
  };
}

export default async function CatalogProductPage({ params }: PageProps<"/catalogo/[id]">) {
  // Dados da loja vêm do banco: renderiza a cada requisição em vez de prerenderizar no build
  await connection();
  const store = await getCatalogStore();
  if (!store) return <CatalogUnavailable reason="error" />;
  if (!store.enabled) return <CatalogUnavailable reason="disabled" />;

  const product = await getCatalogProduct((await params).id);
  if (!product) notFound();

  return (
    <div className="space-y-4">
      <Link
        href="/catalogo"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" aria-hidden /> Voltar ao catálogo
      </Link>

      <article className="bg-card grid gap-4 overflow-hidden rounded-xl border sm:grid-cols-2">
        <CatalogImage
          src={product.imageUrl}
          alt={product.name}
          priority
          className="aspect-square w-full"
        />
        <div className="flex min-w-0 flex-col gap-3 p-4 sm:py-6 sm:pr-6 sm:pl-2">
          {product.categoryName && (
            <span className="text-muted-foreground text-sm">{product.categoryName}</span>
          )}
          <h1 className="text-xl font-bold tracking-tight break-words sm:text-2xl">
            {product.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-2xl font-semibold">
              {formatCurrency(product.price)}
              <span className="text-muted-foreground text-sm font-normal"> / {product.unit}</span>
            </p>
            <CatalogAvailabilityBadge available={product.available} />
          </div>
          {product.description && (
            <p className="text-muted-foreground text-sm break-words whitespace-pre-line">
              {product.description}
            </p>
          )}
          <CatalogAddButton
            withQuantity
            className="mt-auto pt-2"
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
      </article>
    </div>
  );
}
