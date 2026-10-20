import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { getCatalogSitemapEntries, getCatalogStore } from "@/lib/catalog";
import { SITE_URL } from "@/lib/site-url";

// Servido em /sitemap.xml. Lido na requisição (como as páginas do catálogo), para o build não
// depender do banco; sem banco ou com o catálogo desativado, lista só a landing.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const entries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "monthly", priority: 1 },
  ];

  const store = await getCatalogStore();
  if (!store?.enabled) return entries;

  const products = await getCatalogSitemapEntries();
  entries.push(
    {
      url: `${SITE_URL}/catalogo`,
      lastModified: products[0]?.updatedAt,
      changeFrequency: "daily",
      priority: 0.8,
    },
    ...products.map((product) => ({
      url: `${SITE_URL}/catalogo/${product.id}`,
      lastModified: product.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  );
  return entries;
}
