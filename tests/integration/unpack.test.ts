import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CashRegisterStatus, Prisma, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { registerUnpack, type UnpackInput } from "@/lib/unpack";
import { registerSale } from "@/lib/create-sale";
import { createUser, resetDatabase, saleInput, seedStore, stockOf, type Store } from "./fixtures";

const { authorize, revalidatePath } = vi.hoisted(() => ({
  authorize: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({ authorize }));
vi.mock("next/cache", () => ({ revalidatePath }));
const { openStockBoxes, openPdvBoxes } = await import("@/actions/unpack");
const { createProduct, updateProduct, deleteProduct, getProducts, refreshUnpackProducts } =
  await import("@/actions/products");
const { getStockMovements } = await import("@/actions/stock");

let store: Store;
let boxId: string;
let unitId: string;

beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
  const unit = await prisma.product.create({
    data: {
      name: "Cerveja Skol lata 260ml 1UN",
      costPrice: 3,
      salePrice: 8,
      unit: Unit.UN,
      currentStock: 0,
    },
  });
  const box = await prisma.product.create({
    data: {
      name: "Caixa Skol 260ml 12UN",
      costPrice: 56,
      salePrice: 56,
      unit: Unit.CX,
      currentStock: 3,
      containedProductId: unit.id,
      unitsPerBox: 12,
    },
  });
  boxId = box.id;
  unitId = unit.id;
  authorize.mockReset();
  revalidatePath.mockReset();
  authorize.mockResolvedValue({
    ok: true,
    user: { id: store.user.id, name: store.user.name, role: "ADMIN" },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function unpackInput(overrides: Partial<UnpackInput> = {}): UnpackInput {
  return {
    operationId: randomUUID(),
    boxProductId: boxId,
    expectedUnitProductId: unitId,
    expectedUnitsPerBox: 12,
    boxQuantity: 1,
    ...overrides,
  };
}

async function editBox(data: Record<string, unknown> = {}) {
  return updateProduct(boxId, {
    name: "Caixa Skol 260ml 12UN",
    costPrice: 56,
    salePrice: 56,
    unit: "CX",
    ...data,
  });
}

describe("abertura de caixas", () => {
  it("compra 3 caixas, abre 1 e vende 1 lata: restam 2 caixas e 11 latas", async () => {
    const opening = await openStockBoxes(unpackInput());
    expect(opening.success).toBe(true);
    expect(await stockOf(boxId)).toBe("2");
    expect(await stockOf(unitId)).toBe("12");
    const sale = await registerSale(
      store.user.id,
      saleInput(store, {
        items: [{ productId: unitId, quantity: 1 }],
        amountPaid: 8,
      }),
    );
    expect(sale.success).toBe(true);
    expect(await stockOf(boxId)).toBe("2");
    expect(await stockOf(unitId)).toBe("11");
    expect(await prisma.unpackConversion.count()).toBe(1);
  });

  it("abre 2 caixas e vende 13 latas: restam 1 caixa e 11 latas", async () => {
    expect((await registerUnpack(store.user.id, unpackInput({ boxQuantity: 2 }))).success).toBe(
      true,
    );
    expect(
      (
        await registerSale(
          store.user.id,
          saleInput(store, {
            items: [{ productId: unitId, quantity: 13 }],
            amountPaid: 104,
          }),
        )
      ).success,
    ).toBe(true);
    expect(await stockOf(boxId)).toBe("1");
    expect(await stockOf(unitId)).toBe("11");
  });

  it("abandonar a venda mantém a abertura e não gera receita, título ou caixa", async () => {
    expect((await openPdvBoxes(unpackInput())).success).toBe(true);
    expect(await stockOf(boxId)).toBe("2");
    expect(await stockOf(unitId)).toBe("12");
    expect(await prisma.sale.count()).toBe(0);
    expect(await prisma.receivable.count()).toBe(0);
    expect(await prisma.cashMovement.count()).toBe(0);
    expect(await prisma.stockMovement.count()).toBe(2);
  });

  it("preserva custo exato, duas movimentações e autoria com o mesmo identificador", async () => {
    const input = unpackInput();
    const result = await registerUnpack(store.user.id, input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const conversion = await prisma.unpackConversion.findUniqueOrThrow({
      where: { id: input.operationId },
    });
    expect(conversion.unitsPerBox).toBe(12);
    expect(conversion.totalCost.toFixed(2)).toBe("56.00");
    expect(conversion.unitCostBase.toFixed(2)).toBe("4.66");
    expect(conversion.extraCostUnits).toBe(8);
    expect(
      conversion.unitCostBase
        .mul(conversion.unitQuantity)
        .add(new Prisma.Decimal(conversion.extraCostUnits).div(100))
        .equals(conversion.totalCost),
    ).toBe(true);
    expect(result.data.appliedTxid).toBe(conversion.appliedTxid.toString());
    const movements = await prisma.stockMovement.findMany({
      where: { conversionId: conversion.id },
    });
    expect(movements).toHaveLength(2);
    expect(movements.map((m) => [m.type, m.quantity.toString()]).sort()).toEqual([
      ["IN", "12"],
      ["OUT", "1"],
    ]);
    for (const m of movements) {
      expect(m.userId).toBe(store.user.id);
      expect(m.totalCost!.toFixed(2)).toBe("56.00");
      expect(m.createdAt).toEqual(conversion.createdAt);
    }
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: unitId } })).costPrice.toString(),
    ).toBe("3");
  });

  it("repetição, inclusive concorrente, não duplica efeitos", async () => {
    const input = unpackInput();
    const results = await Promise.all([
      registerUnpack(store.user.id, input),
      registerUnpack(store.user.id, input),
    ]);
    expect(results.every((r) => r.success)).toBe(true);
    expect(results.filter((r) => r.success && r.data.replayed)).toHaveLength(1);
    expect(await prisma.unpackConversion.count()).toBe(1);
    expect(await prisma.stockMovement.count()).toBe(2);
    expect(await stockOf(boxId)).toBe("2");
    expect(await stockOf(unitId)).toBe("12");
  });

  it("mesma chave com outro payload ou autor é recusada", async () => {
    const input = unpackInput();
    expect((await registerUnpack(store.user.id, input)).success).toBe(true);
    expect((await registerUnpack(store.user.id, { ...input, boxQuantity: 2 })).success).toBe(false);
    const other = await createUser();
    expect((await registerUnpack(other.id, input)).success).toBe(false);
    expect(await prisma.unpackConversion.count()).toBe(1);
    expect(await stockOf(boxId)).toBe("2");
  });

  it("duas aberturas simultâneas não tornam o estoque negativo", async () => {
    const results = await Promise.all([
      registerUnpack(store.user.id, unpackInput({ boxQuantity: 2 })),
      registerUnpack(store.user.id, unpackInput({ boxQuantity: 2 })),
    ]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(await stockOf(boxId)).toBe("1");
    expect(await stockOf(unitId)).toBe("24");
    expect(await prisma.stockMovement.count()).toBe(2);
  });

  it("venda da caixa inteira e abertura concorrentes disputam o mesmo saldo sem duplicá-lo", async () => {
    const results = await Promise.all([
      registerUnpack(store.user.id, unpackInput()),
      registerSale(
        store.user.id,
        saleInput(store, {
          items: [{ productId: boxId, quantity: 3 }],
          amountPaid: 168,
        }),
      ),
    ]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    if (results[0].success) {
      expect(await stockOf(boxId)).toBe("2");
      expect(await stockOf(unitId)).toBe("12");
      expect(await prisma.sale.count()).toBe(0);
    } else {
      expect(await stockOf(boxId)).toBe("0");
      expect(await stockOf(unitId)).toBe("0");
      expect(await prisma.unpackConversion.count()).toBe(0);
    }
  });

  it("preserva as caixas no carrinho e recusa abrir uma caixa já destinada à venda", async () => {
    const refused = await registerUnpack(
      store.user.id,
      unpackInput({ boxQuantity: 2, reservedBoxes: 2 }),
    );
    expect(refused.success).toBe(false);
    expect(await prisma.unpackConversion.count()).toBe(0);
    expect(await stockOf(boxId)).toBe("3");
    expect((await registerUnpack(store.user.id, unpackInput({ reservedBoxes: 2 }))).success).toBe(
      true,
    );
    const sold = await registerSale(
      store.user.id,
      saleInput(store, {
        items: [
          { productId: boxId, quantity: 2 },
          { productId: unitId, quantity: 1 },
        ],
        amountPaid: 120,
      }),
    );
    expect(sold.success).toBe(true);
    expect(await stockOf(boxId)).toBe("0");
    expect(await stockOf(unitId)).toBe("11");
  });

  it("saldo insuficiente e entrada inválida não deixam efeitos parciais", async () => {
    for (const overrides of [
      { boxQuantity: 4 },
      { boxQuantity: 0 },
      { boxQuantity: 0.5 },
      { boxQuantity: Number.NaN },
      { reservedBoxes: -1 },
      { reservedBoxes: 0.5 },
      { expectedUnitsPerBox: 1 },
      { expectedUnitProductId: boxId },
      { operationId: "invalid" },
    ]) {
      expect((await registerUnpack(store.user.id, unpackInput(overrides))).success).toBe(false);
    }
    expect(await prisma.unpackConversion.count()).toBe(0);
    expect(await prisma.stockMovement.count()).toBe(0);
    expect(await stockOf(boxId)).toBe("3");
    expect(await stockOf(unitId)).toBe("0");
  });

  it("recusa vínculo/fator desatualizado e saldo que ultrapassaria capacidade do banco", async () => {
    expect((await editBox({ unitsPerBox: 24 })).success).toBe(true);
    expect((await registerUnpack(store.user.id, unpackInput())).success).toBe(false);
    await prisma.product.update({ where: { id: unitId }, data: { currentStock: "9999999" } });
    expect(
      (await registerUnpack(store.user.id, unpackInput({ expectedUnitsPerBox: 24 }))).success,
    ).toBe(false);
    expect(await stockOf(boxId)).toBe("3");
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it("edição concorrente de fator e custo não altera o snapshot de uma abertura", async () => {
    const results = await Promise.all([
      registerUnpack(store.user.id, unpackInput()),
      editBox({ unitsPerBox: 24, costPrice: 60 }),
    ]);
    expect(results[1].success).toBe(true);
    const conversions = await prisma.unpackConversion.findMany();
    if (results[0].success) {
      expect(conversions).toHaveLength(1);
      expect(conversions[0].unitsPerBox).toBe(12);
      expect(conversions[0].boxUnitCost.toFixed(2)).toBe("56.00");
    } else {
      expect(conversions).toHaveLength(0);
      expect(await stockOf(boxId)).toBe("3");
    }
  });
});

describe("cadastro, permissões e histórico", () => {
  it("permite cadastrar CX vinculada e recusa outra origem para o mesmo avulso", async () => {
    const unit = await prisma.product.create({
      data: { name: "Avulso novo", costPrice: 1, salePrice: 2 },
    });
    const data = {
      name: "Caixa nova",
      costPrice: 10,
      salePrice: 15,
      unit: "CX" as const,
      containedProductId: unit.id,
      unitsPerBox: 6,
    };
    expect((await createProduct(data)).success).toBe(true);
    expect((await createProduct({ ...data, name: "Caixa duplicada" })).success).toBe(false);
    const rows = await prisma.product.findMany({ where: { containedProductId: unit.id } });
    expect(rows).toHaveLength(1);
  });

  it("recusa mudança de unidade que invalidaria vínculo, destino inativo e fator fracionado", async () => {
    expect(
      (await updateProduct(unitId, { name: "Lata", unit: "KG", costPrice: 3, salePrice: 8 }))
        .success,
    ).toBe(false);
    expect((await editBox({ unit: "UN" })).success).toBe(false);
    expect((await editBox({ unitsPerBox: 1.5 })).success).toBe(false);
    expect((await editBox({ containedProductId: boxId })).success).toBe(false);
    const inactive = await prisma.product.create({
      data: { name: "Inativo", costPrice: 1, salePrice: 2, deletedAt: new Date() },
    });
    expect((await editBox({ containedProductId: inactive.id })).success).toBe(false);
    expect((await editBox({ containedProductId: store.cheese.id })).success).toBe(false);
    expect((await editBox({ containedProductId: null, unitsPerBox: null })).success).toBe(true);
    expect(
      (await updateProduct(unitId, { name: "Lata", unit: "KG", costPrice: 3, salePrice: 8 }))
        .success,
    ).toBe(true);
  });

  it("exclusão lógica do avulso desfaz vínculo sem apagar conversão ou movimentações", async () => {
    const input = unpackInput();
    expect((await registerUnpack(store.user.id, input)).success).toBe(true);
    expect(await deleteProduct(unitId)).toEqual({ success: true });
    const box = await prisma.product.findUniqueOrThrow({ where: { id: boxId } });
    expect(box.containedProductId).toBeNull();
    expect(box.unitsPerBox).toBeNull();
    expect(await prisma.unpackConversion.count()).toBe(1);
    expect(await prisma.stockMovement.count()).toBe(2);
    expect((await registerUnpack(store.user.id, input)).success).toBe(true);
    expect((await registerUnpack(store.user.id, unpackInput())).success).toBe(false);
  });

  it("exclusão lógica da caixa libera o avulso para outra origem", async () => {
    expect((await registerUnpack(store.user.id, unpackInput())).success).toBe(true);
    expect(await deleteProduct(boxId)).toEqual({ success: true });
    expect(
      (
        await createProduct({
          name: "Caixa substituta",
          costPrice: 56,
          salePrice: 56,
          unit: "CX",
          containedProductId: unitId,
          unitsPerBox: 12,
        })
      ).success,
    ).toBe(true);
    expect(await prisma.unpackConversion.count()).toBe(1);
  });

  it("ações usam permissões específicas e recusa não grava efeitos", async () => {
    authorize.mockResolvedValue({ ok: false, error: "Sem permissão" });
    expect(await openStockBoxes(unpackInput())).toEqual({
      success: false,
      error: "Sem permissão",
      uncertain: true,
    });
    expect(await openPdvBoxes(unpackInput())).toEqual({
      success: false,
      error: "Sem permissão",
      uncertain: true,
    });
    expect(authorize).toHaveBeenCalledWith("stock.manage");
    expect(authorize).toHaveBeenCalledWith("pdv.use");
    expect(await prisma.unpackConversion.count()).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("PDV exige caixa próprio aberto, mas replay continua válido após fechamento", async () => {
    const other = await createUser();
    expect((await registerUnpack(other.id, unpackInput(), "pdv")).success).toBe(false);
    const input = unpackInput();
    const first = await registerUnpack(store.user.id, input, "pdv");
    expect(first.success).toBe(true);
    await prisma.cashRegister.update({
      where: { id: store.cashRegister.id },
      data: { status: CashRegisterStatus.CLOSED, openUserId: null, closedAt: new Date() },
    });
    const replay = await registerUnpack(store.user.id, input, "pdv");
    expect(replay.success && replay.data.replayed).toBe(true);
    expect((await registerUnpack(store.user.id, unpackInput(), "pdv")).success).toBe(false);
    expect(await prisma.unpackConversion.count()).toBe(1);
  });

  it("custos do histórico e cadastro são omitidos para SELLER, inclusive retorno da abertura", async () => {
    const result = await openStockBoxes(unpackInput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("totalCost");
      expect(result.data).not.toHaveProperty("unitCostBase");
    }
    const managerHistory = await getStockMovements();
    expect(managerHistory.items.every((m) => m.totalCost === 56)).toBe(true);
    expect(managerHistory.items.find((m) => m.type === "IN")?.extraCostUnits).toBe(8);
    expect(managerHistory.items.find((m) => m.type === "OUT")?.extraCostUnits).toBeNull();
    authorize.mockResolvedValue({
      ok: true,
      user: { id: store.user.id, name: store.user.name, role: "SELLER" },
    });
    const history = await getStockMovements();
    for (const m of history.items) {
      expect(m.conversionId).toBeTruthy();
      expect(m).not.toHaveProperty("unitCost");
      expect(m).not.toHaveProperty("totalCost");
      expect(m).not.toHaveProperty("extraCostUnits");
    }
    for (const p of await getProducts()) expect(p).not.toHaveProperty("costPrice");
  });

  it("falha de revalidação depois do commit conserva resposta confirmada e pode ser reenviada", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    revalidatePath.mockImplementation(() => {
      throw new Error("cache unavailable");
    });
    const input = unpackInput();
    const first = await openStockBoxes(input);
    const replay = await openStockBoxes(input);
    expect(first.success).toBe(true);
    expect(replay.success && replay.data.replayed).toBe(true);
    expect(await prisma.unpackConversion.count()).toBe(1);
    log.mockRestore();
    revalidatePath.mockReset();
  });

  it("atualização confiável distingue catálogo vazio de falha e mantém custos privados", async () => {
    authorize.mockResolvedValue({
      ok: true,
      user: { id: store.user.id, name: store.user.name, role: "SELLER" },
    });
    const visible = await refreshUnpackProducts();
    expect(visible.success).toBe(true);
    if (visible.success) {
      expect(visible.products).toHaveLength(4);
      for (const product of visible.products) expect(product).not.toHaveProperty("costPrice");
    }
    await prisma.product.updateMany({ data: { deletedAt: new Date() } });
    expect(await refreshUnpackProducts()).toEqual({ success: true, products: [] });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const query = vi
      .spyOn(prisma.product, "findMany")
      .mockRejectedValueOnce(new Error("database unavailable"));
    expect((await refreshUnpackProducts()).success).toBe(false);
    query.mockRestore();
    log.mockRestore();
    authorize.mockResolvedValue({ ok: false, error: "Sessão expirada" });
    expect(await refreshUnpackProducts()).toEqual({ success: false, error: "Sessão expirada" });
  });

  it("falta de sessão após resposta perdida preserva a chave até relogar e recuperar", async () => {
    const input = unpackInput();
    expect((await openStockBoxes(input)).success).toBe(true);
    authorize.mockResolvedValue({ ok: false, error: "Sessão expirada" });
    expect(await openStockBoxes(input)).toEqual({
      success: false,
      error: "Sessão expirada",
      uncertain: true,
    });
    authorize.mockResolvedValue({
      ok: true,
      user: { id: store.user.id, name: store.user.name, role: "ADMIN" },
    });
    const replay = await openStockBoxes(input);
    expect(replay.success && replay.data.replayed).toBe(true);
    expect(await prisma.unpackConversion.count()).toBe(1);
  });
});
