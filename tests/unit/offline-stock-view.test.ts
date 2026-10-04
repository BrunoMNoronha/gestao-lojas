import { describe, expect, it } from "vitest";
import type { LocalCategory, LocalProduct } from "@/lib/offline/db";
import { availableStock } from "@/lib/offline/sale-operation";
import { buildStockRows, filterStockRows, type StockFilter } from "@/lib/offline/stock-view";

// Consulta de estoque do /pdv (issue #54): saldo da cópia menos as vendas pendentes, estoque
// baixo pela mesma regra do servidor (saldo <= mínimo) e filtros.

function product(overrides: Partial<LocalProduct> & { id: string }): LocalProduct {
  return {
    deleted: false,
    name: `Produto ${overrides.id}`,
    sku: null,
    barcode: null,
    salePrice: "10.00",
    unit: "UN",
    currentStock: "10.000",
    minStock: "0.000",
    categoryId: null,
    updatedAt: "2026-10-04T12:00:00.000Z",
    ...overrides,
  };
}

const categories: LocalCategory[] = [
  { id: "c1", deleted: false, name: "Grãos" },
  { id: "c2", deleted: false, name: "Laticínios" },
];

const ALL: StockFilter = { query: "", categoryId: "", onlyLow: false };

describe("availableStock", () => {
  it("desconta o reservado sem erro de ponto flutuante", () => {
    // 0,3 - 0,1 em ponto flutuante dá 0,19999999999999998
    expect(availableStock("0.300", 0.1)).toBe(0.2);
    expect(availableStock("1.000", 0.7)).toBe(0.3);
    expect(availableStock("10.000")).toBe(10);
  });

  it("pode ficar negativo (vendas pendentes acima do saldo sincronizado)", () => {
    expect(availableStock("1.000", 3)).toBe(-2);
  });
});

describe("buildStockRows", () => {
  it("calcula sincronizado, pendentes e disponível, com o nome da categoria", () => {
    const [row] = buildStockRows(
      [product({ id: "p1", currentStock: "5.250", unit: "KG", categoryId: "c1" })],
      categories,
      new Map([["p1", 1.1]]),
    );
    expect(row).toMatchObject({
      syncedStock: 5.25,
      pending: 1.1,
      available: 4.15,
      categoryName: "Grãos",
    });
  });

  it("estoque baixo pelo saldo disponível: saldo <= mínimo, como no servidor", () => {
    const rows = buildStockRows(
      [
        product({ id: "acima", currentStock: "6.000", minStock: "5.000" }),
        product({ id: "igual", currentStock: "5.000", minStock: "5.000" }),
        // Sincronizado acima do mínimo, mas as vendas pendentes o levam abaixo
        product({ id: "pendente", currentStock: "6.000", minStock: "5.000" }),
        // Mínimo zero e saldo zero também é baixo (mesma regra do isStockLow)
        product({ id: "zerado", currentStock: "0.000", minStock: "0.000" }),
      ],
      [],
      new Map([["pendente", 2]]),
    );
    const low = Object.fromEntries(rows.map((row) => [row.id, row.low]));
    expect(low).toEqual({ acima: false, igual: true, pendente: true, zerado: true });
  });

  it("sem estoque mínimo na cópia (guardada antes da #54), estoque baixo é desconhecido", () => {
    const old = product({ id: "antigo", currentStock: "0.000" });
    delete old.minStock;
    const [row] = buildStockRows([old], [], new Map());
    expect(row.minStock).toBeNull();
    expect(row.low).toBeNull();
  });

  it("ordena por nome", () => {
    const rows = buildStockRows(
      [product({ id: "b", name: "Óleo" }), product({ id: "a", name: "Arroz" })],
      [],
      new Map(),
    );
    expect(rows.map((row) => row.name)).toEqual(["Arroz", "Óleo"]);
  });
});

describe("filterStockRows", () => {
  const rows = buildStockRows(
    [
      product({ id: "p1", name: "Arroz 5kg", sku: "ARR-5", barcode: "789001", categoryId: "c1" }),
      product({
        id: "p2",
        name: "Queijo",
        currentStock: "1.000",
        minStock: "2.000",
        categoryId: "c2",
      }),
      product({ id: "p3", name: "Sabão", barcode: "789555" }),
    ],
    categories,
    new Map(),
  );
  const ids = (filter: Partial<StockFilter>) =>
    filterStockRows(rows, { ...ALL, ...filter }).map((row) => row.id);

  it("busca por nome, SKU e código de barras, sem diferenciar maiúsculas", () => {
    expect(ids({ query: "arroz" })).toEqual(["p1"]);
    expect(ids({ query: "arr-5" })).toEqual(["p1"]);
    expect(ids({ query: "789555" })).toEqual(["p3"]);
    expect(ids({ query: "  " })).toEqual(["p1", "p2", "p3"]);
  });

  it("filtra por categoria, sem categoria e estoque baixo", () => {
    expect(ids({ categoryId: "c2" })).toEqual(["p2"]);
    expect(ids({ categoryId: "none" })).toEqual(["p3"]);
    expect(ids({ onlyLow: true })).toEqual(["p2"]);
    expect(ids({ onlyLow: true, categoryId: "c1" })).toEqual([]);
  });
});
