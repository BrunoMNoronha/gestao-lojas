import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase, seedStore, type Store } from "./fixtures";
const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("@/lib/authz", () => ({ authorize }));
const {
  getProductPage,
  getPdvProducts,
  getProductOptions,
  getCustomerPage,
  getCustomerOptions,
  getStockCounts,
} = await import("@/actions/browse");
let store: Store;
beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
  authorize.mockResolvedValue({
    ok: true,
    user: { id: store.user.id, name: store.user.name, role: "SELLER" },
  });
});
afterAll(() => prisma.$disconnect());

it("pagina produtos com ordenação estável, busca no servidor e custo omitido para vendedor", async () => {
  await prisma.product.createMany({
    data: Array.from({ length: 61 }, (_, i) => ({
      id: `page-${i.toString().padStart(3, "0")}`,
      name: "Produto igual",
      salePrice: 10,
      costPrice: 7,
      showInCatalog: true,
    })),
  });
  const first = await getProductPage({ q: "Produto igual", catalog: "IN" });
  const second = await getProductPage({ q: "Produto igual", catalog: "IN", page: 2 });
  expect(first.items).toHaveLength(50);
  expect(second.items).toHaveLength(11);
  expect(first.total).toBe(61);
  expect(new Set([...first.items, ...second.items].map((p) => p.id)).size).toBe(61);
  expect(first.items.every((p) => !("costPrice" in p))).toBe(true);
  await prisma.product.update({ where: { id: "page-060" }, data: { sku: "igual" } });
  expect((await getProductOptions("igual", undefined, undefined, true)).map((p) => p.id)).toEqual([
    "page-060",
  ]);
  expect((await getProductPage({ q: "Produto igual", catalog: "OUT" })).total).toBe(0);
  authorize.mockResolvedValue({
    ok: true,
    user: { id: store.user.id, name: store.user.name, role: "MANAGER" },
  });
  expect((await getProductPage({ q: "Produto igual" })).items[0].costPrice).toBe(7);
});
it("PDV seleciona apenas campos necessários e encontra código fora da primeira página", async () => {
  await prisma.product.createMany({
    data: Array.from({ length: 60 }, (_, i) => ({
      name: `A produto ${i}`,
      salePrice: 10,
      costPrice: 7,
    })),
  });
  await prisma.product.update({
    where: { id: store.cheese.id },
    data: { barcode: "7890012345678", description: "Dado interno extenso" },
  });
  expect(await getPdvProducts()).toHaveLength(50);
  const result = await getPdvProducts("7890012345678", undefined, true);
  expect(result).toHaveLength(1);
  expect(result[0].id).toBe(store.cheese.id);
  expect(Object.keys(result[0]).sort()).toEqual(
    [
      "id",
      "name",
      "sku",
      "barcode",
      "salePrice",
      "unit",
      "currentStock",
      "containedProductId",
      "unitsPerBox",
    ].sort(),
  );
});
it("busca mantém a caixa de origem e o avulso disponíveis fora da página", async () => {
  const box = await prisma.product.create({
    data: {
      name: "Caixa",
      unit: "CX",
      salePrice: 56,
      costPrice: 24,
      containedProductId: store.rice.id,
      unitsPerBox: 12,
      currentStock: 3,
    },
  });
  const rows = await getPdvProducts("Arroz");
  expect(rows.map((p) => p.id).sort()).toEqual([box.id, store.rice.id].sort());
  expect((await getProductOptions("", box.id))[0].containedProduct?.id).toBe(store.rice.id);
  expect(await getProductOptions("Arroz", undefined, "outra-caixa")).toHaveLength(0);
  expect(await getProductOptions("Arroz", undefined, box.id)).toHaveLength(1);
  expect(await getProductOptions("Arroz", undefined, store.rice.id)).toHaveLength(0);
});
it("clientes paginam contagens e opções não levam histórico ou endereço", async () => {
  await prisma.customer.createMany({
    data: Array.from({ length: 60 }, (_, i) => ({
      name: `Cliente ${i}`,
      document: i === 59 ? "12345678901" : null,
      address: "Endereço privado",
    })),
  });
  const options = await getCustomerOptions();
  expect(options).toHaveLength(50);
  expect(Object.keys(options[0]).sort()).toEqual(["id", "name", "document", "phone"].sort());
  const masked = await getCustomerOptions("123.456.789-01");
  expect(masked).toHaveLength(1);
  const page = await getCustomerPage({ page: 2 });
  expect(page.items).toHaveLength(11);
  expect(page.total).toBe(61);
  expect(page.items[0]._count?.sales).toBe(0);
});
it("contagens de estoque consideram toda a base, frações e exclusão lógica", async () => {
  await prisma.product.update({
    where: { id: store.rice.id },
    data: { currentStock: 0, minStock: 5 },
  });
  await prisma.product.update({
    where: { id: store.cheese.id },
    data: { currentStock: -0.5, minStock: 1 },
  });
  await prisma.product.create({
    data: { name: "Excluído", costPrice: 1, salePrice: 2, deletedAt: new Date() },
  });
  expect(await getStockCounts()).toEqual({ total: 2, low: 2, zero: 1, negative: 1 });
  expect((await getProductPage({ stock: "negative" })).items.map((p) => p.id)).toEqual([
    store.cheese.id,
  ]);
});
it("consultas novas recusam acesso antes de consultar dados", async () => {
  authorize.mockResolvedValue({ ok: false, error: "Sem acesso" });
  expect(await getPdvProducts()).toEqual([]);
  expect(await getCustomerOptions()).toEqual([]);
  expect((await getProductPage()).items).toEqual([]);
  expect((await getCustomerPage()).items).toEqual([]);
  expect(await getStockCounts()).toEqual({ total: 0, low: 0, zero: 0, negative: 0 });
});

it("busca do PDV não reintroduz um produto excluído por meio do vínculo", async () => {
  const box = await prisma.product.create({
    data: {
      name: "Caixa antiga",
      unit: "CX",
      salePrice: 12,
      costPrice: 6,
      containedProductId: store.rice.id,
      unitsPerBox: 12,
      deletedAt: new Date(),
    },
  });
  const rows = await getPdvProducts("Arroz");
  expect(rows.map((p) => p.id)).toEqual([store.rice.id]);
  expect(rows.some((p) => p.id === box.id)).toBe(false);
});
