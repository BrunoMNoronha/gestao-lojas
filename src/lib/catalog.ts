import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CATALOG_PAGE_SIZE, type CatalogFilters, type CatalogUnit } from "@/lib/catalog-shared";

// Leitura pública do catálogo (issue #17), sem sessão. Não são Server Actions: são funções de
// servidor chamadas pelas páginas de /catalogo e pela rota do pedido. Os `select` trazem só campos
// de vitrine; o saldo é lido apenas para virar "Disponível"/"Indisponível" e nunca sai daqui.
// Custo e estoque mínimo nunca são consultados.

export interface CatalogStore {
  enabled: boolean;
  name: string;
  whatsappNumber: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  instagram: string | null;
}

export interface CatalogProduct {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  categoryName: string | null;
  price: number;
  unit: CatalogUnit;
  available: boolean;
}

export interface CatalogPage {
  products: CatalogProduct[];
  total: number;
  page: number;
  pageCount: number;
}

const productSelect = {
  id: true,
  name: true,
  description: true,
  imageUrl: true,
  salePrice: true,
  unit: true,
  currentStock: true,
  category: { select: { name: true } },
} satisfies Prisma.ProductSelect;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

function toCatalogProduct(row: ProductRow): CatalogProduct {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    imageUrl: row.imageUrl,
    categoryName: row.category?.name ?? null,
    price: Number(row.salePrice),
    unit: row.unit as CatalogUnit,
    available: row.currentStock.gt(0),
  };
}

function joinAddress(parts: {
  address: string | null;
  number: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}): string | null {
  const street = [parts.address, parts.number].filter(Boolean).join(", ");
  const city = [parts.city, parts.state].filter(Boolean).join("/");
  const line = [street, parts.neighborhood, city].filter(Boolean).join(" – ");
  return line || null;
}

/** Dados públicos da loja; null se o banco falhar (a página mostra "indisponível"). */
export const getCatalogStore = cache(async (): Promise<CatalogStore | null> => {
  try {
    const settings = await prisma.storeSettings.findUnique({
      where: { id: "default" },
      select: {
        catalogEnabled: true,
        tradeName: true,
        whatsappNumber: true,
        phone: true,
        email: true,
        address: true,
        number: true,
        neighborhood: true,
        city: true,
        state: true,
        instagram: true,
      },
    });
    if (!settings) {
      return {
        enabled: false,
        name: "Catálogo",
        whatsappNumber: null,
        phone: null,
        email: null,
        address: null,
        instagram: null,
      };
    }
    return {
      enabled: settings.catalogEnabled,
      name: settings.tradeName.trim() || "Catálogo",
      whatsappNumber: settings.whatsappNumber || null,
      phone: settings.phone || null,
      email: settings.email || null,
      address: joinAddress(settings),
      instagram: settings.instagram || null,
    };
  } catch (error) {
    console.error("Erro ao carregar os dados públicos da loja:", error);
    return null;
  }
});

/** Página de produtos visíveis com busca, categoria, "somente disponíveis" e ordenação. */
export async function getCatalogProducts(filters: CatalogFilters): Promise<CatalogPage | null> {
  try {
    const where: Prisma.ProductWhereInput = { showInCatalog: true };
    if (filters.q) {
      where.OR = [
        { name: { contains: filters.q, mode: "insensitive" } },
        { sku: { contains: filters.q, mode: "insensitive" } },
        { barcode: { contains: filters.q, mode: "insensitive" } },
      ];
    }
    if (filters.category) where.categoryId = filters.category;
    if (filters.available) where.currentStock = { gt: 0 };

    const orderBy: Prisma.ProductOrderByWithRelationInput[] =
      filters.sort === "menor-preco"
        ? [{ salePrice: "asc" }, { name: "asc" }, { id: "asc" }]
        : filters.sort === "maior-preco"
          ? [{ salePrice: "desc" }, { name: "asc" }, { id: "asc" }]
          : [{ name: "asc" }, { id: "asc" }];

    const total = await prisma.product.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));
    const page = Math.min(filters.page, pageCount);

    const rows = await prisma.product.findMany({
      where,
      select: productSelect,
      orderBy,
      skip: (page - 1) * CATALOG_PAGE_SIZE,
      take: CATALOG_PAGE_SIZE,
    });

    return { products: rows.map(toCatalogProduct), total, page, pageCount };
  } catch (error) {
    console.error("Erro ao carregar os produtos do catálogo:", error);
    return null;
  }
}

/** Categorias com ao menos um produto visível no catálogo. */
export async function getCatalogCategories(): Promise<{ id: string; name: string }[]> {
  try {
    return await prisma.category.findMany({
      where: { products: { some: { showInCatalog: true } } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  } catch (error) {
    console.error("Erro ao carregar as categorias do catálogo:", error);
    return [];
  }
}

/** Produto visível no catálogo ou null (inexistente, oculto ou falha de banco). */
export const getCatalogProduct = cache(async (id: string): Promise<CatalogProduct | null> => {
  try {
    const row = await prisma.product.findFirst({
      where: { id, showInCatalog: true },
      select: productSelect,
    });
    return row ? toCatalogProduct(row) : null;
  } catch (error) {
    console.error("Erro ao carregar o produto do catálogo:", error);
    return null;
  }
});
