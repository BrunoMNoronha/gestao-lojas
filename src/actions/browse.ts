"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { PAGE_SIZE, pageNumber, type ListFilters } from "@/lib/pagination";
import { maskedSearchTerms } from "@/lib/masks";
import type { ProductItem } from "@/actions/products";
import type { CustomerItem } from "@/actions/customers";

function productWhere(filters: ListFilters): Prisma.ProductWhereInput {
  const q = filters.q?.trim().slice(0, 200);
  return {
    deletedAt: null,
    ...(q
      ? {
          OR: ["name", "sku", "barcode"].map((field) => ({
            [field]: { contains: q, mode: "insensitive" },
          })),
        }
      : {}),
    ...(filters.category && filters.category !== "ALL" ? { categoryId: filters.category } : {}),
    ...(filters.catalog === "IN" || filters.catalog === "OUT"
      ? { showInCatalog: filters.catalog === "IN" }
      : {}),
    ...(filters.stock === "low" ? { currentStock: { lte: prisma.product.fields.minStock } } : {}),
    ...(filters.stock === "negative" ? { currentStock: { lt: 0 } } : {}),
    ...(filters.stock === "zero" ? { currentStock: 0 } : {}),
    ...(filters.stock === "boxes" ? { containedProductId: { not: null } } : {}),
  };
}
function customerWhere(q?: string): Prisma.CustomerWhereInput {
  const term = q?.trim().slice(0, 200);
  return {
    deletedAt: null,
    ...(term
      ? {
          OR: [
            { name: { contains: term, mode: "insensitive" as const } },
            { email: { contains: term, mode: "insensitive" as const } },
            ...maskedSearchTerms(term).flatMap((value) => [
              { document: { contains: value, mode: "insensitive" as const } },
              { phone: { contains: value, mode: "insensitive" as const } },
            ]),
          ],
        }
      : {}),
  };
}
const productInclude = {
  category: { select: { name: true } },
  containedProduct: { select: { id: true, name: true, unit: true, currentStock: true } },
  sourceBox: { select: { id: true, name: true, unitsPerBox: true } },
} as const;
function serializeProduct(
  p: Prisma.ProductGetPayload<{ include: typeof productInclude }>,
  cost: boolean,
): ProductItem {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    salePrice: Number(p.salePrice),
    ...(cost ? { costPrice: Number(p.costPrice) } : {}),
    unit: p.unit,
    currentStock: Number(p.currentStock),
    minStock: Number(p.minStock),
    categoryId: p.categoryId,
    categoryName: p.category?.name,
    containedProductId: p.containedProductId,
    containedProductName: p.containedProduct?.name,
    containedProduct: p.containedProduct
      ? { ...p.containedProduct, currentStock: Number(p.containedProduct.currentStock) }
      : null,
    sourceBox: p.sourceBox,
    unitsPerBox: p.unitsPerBox,
    showInCatalog: p.showInCatalog,
    description: p.description,
    imageUrl: p.imageUrl,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
export async function getProductPage(filters: ListFilters = {}) {
  const authz = await authorize("catalog.view");
  if (!authz.ok) return { items: [] as ProductItem[], total: 0, page: 1 };
  const page = pageNumber(filters.page);
  try {
    const where = productWhere(filters);
    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);
    return {
      items: rows.map((p) => serializeProduct(p, can(authz.user.role, "catalog.manage"))),
      total,
      page,
    };
  } catch (error) {
    console.error("Erro ao consultar página de produtos:", error);
    return { items: [] as ProductItem[], total: 0, page };
  }
}
export async function getProductOptions(
  q = "",
  selectedId?: string,
  boxId?: string,
  exact = false,
) {
  const authz = await authorize("catalog.view");
  if (!authz.ok) return [] as ProductItem[];
  try {
    const where = productWhere({ q });
    if (exact)
      where.OR = [
        { barcode: { equals: q.trim(), mode: "insensitive" } },
        { sku: { equals: q.trim(), mode: "insensitive" } },
      ];
    if (boxId !== undefined) {
      where.unit = "UN";
      if (boxId) where.id = { not: boxId };
      where.AND = [{ OR: [{ sourceBox: null }, { sourceBox: { id: boxId } }] }];
    }
    const rows = await prisma.product.findMany({
      where: selectedId ? { deletedAt: null, id: selectedId } : where,
      include: productInclude,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: PAGE_SIZE,
    });
    return rows.map((p) => serializeProduct(p, can(authz.user.role, "catalog.manage")));
  } catch (error) {
    console.error("Erro ao buscar opções de produtos:", error);
    return [];
  }
}
const pdvSelect = {
  id: true,
  name: true,
  sku: true,
  barcode: true,
  salePrice: true,
  unit: true,
  currentStock: true,
  containedProductId: true,
  unitsPerBox: true,
} as const;
export async function getPdvProducts(q = "", ids?: string[], exact = false) {
  const authz = await authorize("pdv.use");
  if (!authz.ok) return [];
  const where: Prisma.ProductWhereInput = ids
    ? { deletedAt: null, id: { in: ids.slice(0, 200) } }
    : exact
      ? {
          deletedAt: null,
          OR: [
            { barcode: { equals: q, mode: "insensitive" } },
            { sku: { equals: q, mode: "insensitive" } },
          ],
        }
      : productWhere({ q });
  const rows = await prisma.product.findMany({
    where,
    select: {
      ...pdvSelect,
      containedProduct: { select: { ...pdvSelect, deletedAt: true } },
      sourceBox: { select: { ...pdvSelect, deletedAt: true } },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: ids ? 200 : PAGE_SIZE,
  });
  // O avulso e sua caixa vêm juntos mesmo que só um deles corresponda à busca.
  const unique = new Map<string, Omit<(typeof rows)[number], "sourceBox" | "containedProduct">>();
  for (const { sourceBox, containedProduct, ...row } of rows) {
    unique.set(row.id, row);
    for (const related of [sourceBox, containedProduct])
      if (related && !related.deletedAt) unique.set(related.id, related);
  }
  return [...unique.values()].map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    unit: p.unit,
    containedProductId: p.containedProductId,
    unitsPerBox: p.unitsPerBox,
    salePrice: Number(p.salePrice),
    currentStock: Number(p.currentStock),
  }));
}
export async function getCustomerPage(filters: ListFilters = {}) {
  const authz = await authorize("customers.view");
  if (!authz.ok) return { items: [] as CustomerItem[], total: 0, page: 1 };
  const page = pageNumber(filters.page);
  try {
    const where = customerWhere(filters.q);
    const [total, rows] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          name: true,
          document: true,
          phone: true,
          email: true,
          address: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);
    const counts = rows.length
      ? await prisma.sale.groupBy({
          by: ["customerId"],
          where: { customerId: { in: rows.map((c) => c.id) } },
          _count: { _all: true },
        })
      : [];
    const salesByCustomer = new Map(counts.map((row) => [row.customerId, row._count._all]));
    return {
      items: rows.map((c) => ({
        ...c,
        _count: { sales: salesByCustomer.get(c.id) ?? 0 },
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
      total,
      page,
    };
  } catch (error) {
    console.error("Erro ao consultar página de clientes:", error);
    return { items: [] as CustomerItem[], total: 0, page };
  }
}
export async function getCustomerOptions(q = "") {
  const authz = await authorize("customers.view");
  if (!authz.ok) return [];
  try {
    return await prisma.customer.findMany({
      where: customerWhere(q),
      select: { id: true, name: true, document: true, phone: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: PAGE_SIZE,
    });
  } catch (error) {
    console.error("Erro ao buscar opções de clientes:", error);
    return [];
  }
}
export async function getStockCounts() {
  const authz = await authorize("stock.view");
  if (!authz.ok) return { total: 0, low: 0, zero: 0, negative: 0 };
  const [total, low, zero, negative] = await Promise.all(
    ["", "low", "zero", "negative"].map((stock) =>
      prisma.product.count({ where: productWhere({ stock }) }),
    ),
  );
  return { total, low, zero, negative };
}
