import { revalidateTag } from "next/cache";
export const CATALOG_CACHE_TAG = "public-catalog";
export const CATALOG_CACHE_OPTIONS = { revalidate: 60, tags: [CATALOG_CACHE_TAG] };
export function invalidateCatalog() {
  // Preço e disponibilidade precisam estar atualizados já na primeira leitura após a mutação.
  revalidateTag(CATALOG_CACHE_TAG, { expire: 0 });
}
