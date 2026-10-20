import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CashRegisterStatus, PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { registerSale } from "@/lib/create-sale";
import {
  effectCounts,
  openCashRegister,
  resetDatabase,
  saleInput,
  seedStore,
  stockOf,
  createUser,
  type Store,
} from "./fixtures";

// Idempotência da venda no servidor (issue #35): a mesma operação produz uma única venda,
// com um único conjunto de itens, movimentações de estoque e título do Fiado.

let store: Store;

beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("registerSale", () => {
  it("grava a venda, os efeitos e a chave da operação na mesma transação", async () => {
    const input = saleInput(store);
    const result = await registerSale(store.user.id, input);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.replayed).toBe(false);
    expect(result.data.total).toBe(42.95);
    expect(result.data.amountPaid).toBe(50);
    expect(result.data.change).toBe(7.05);
    // Venda online: aconteceu quando o servidor a recebeu
    expect(result.data.occurredAt).toBe(result.data.createdAt);

    const operation = await prisma.syncOperation.findUniqueOrThrow({
      where: { id: input.operationId },
    });
    expect(operation).toMatchObject({
      kind: "SALE_CREATE",
      userId: store.user.id,
      cashRegisterId: store.cashRegister.id,
      saleId: result.data.id,
      deviceId: null,
    });
    expect(operation.payloadHash).toMatch(/^[0-9a-f]{64}$/);

    expect(await effectCounts()).toEqual({
      sales: 1,
      items: 2,
      movements: 2,
      receivables: 0,
      operations: 1,
    });
    expect(await stockOf(store.rice.id)).toBe("8");
    expect(await stockOf(store.cheese.id)).toBe("2");
  });

  it("repetição da mesma operação devolve a venda anterior sem novos efeitos", async () => {
    const input = saleInput(store);
    const first = await registerSale(store.user.id, input);
    const second = await registerSale(store.user.id, input);
    const third = await registerSale(store.user.id, structuredClone(input));

    expect(first.success && second.success && third.success).toBe(true);
    if (!first.success || !second.success || !third.success) return;
    expect(second.replayed).toBe(true);
    expect(second.data).toEqual(first.data);
    expect(third.data).toEqual(first.data);

    expect(await effectCounts()).toEqual({
      sales: 1,
      items: 2,
      movements: 2,
      receivables: 0,
      operations: 1,
    });
    expect(await stockOf(store.rice.id)).toBe("8");
  });

  it("o mesmo carrinho em outra ordem ou com linhas repetidas é a mesma operação", async () => {
    const input = saleInput(store);
    const first = await registerSale(store.user.id, input);

    const reordered = {
      ...input,
      amountPaid: 50.0,
      items: [
        { productId: store.cheese.id, quantity: 0.5 },
        { productId: store.rice.id, quantity: 1 },
        { productId: store.rice.id, quantity: 1 },
      ],
    };
    const second = await registerSale(store.user.id, reordered);

    expect(second.success).toBe(true);
    if (!first.success || !second.success) return;
    expect(second.replayed).toBe(true);
    expect(second.data.id).toBe(first.data.id);
    expect((await effectCounts()).sales).toBe(1);
  });

  it("mesma chave com payload diferente é recusada, sem efeitos", async () => {
    const input = saleInput(store);
    await registerSale(store.user.id, input);
    const before = await effectCounts();

    const changed = await registerSale(store.user.id, {
      ...input,
      items: [{ productId: store.rice.id, quantity: 3 }],
    });
    expect(changed).toEqual({
      success: false,
      error: expect.stringContaining("já foi enviada com outros dados"),
    });

    const otherPayment = await registerSale(store.user.id, {
      ...input,
      paymentMethod: PaymentMethod.PIX,
    });
    expect(otherPayment.success).toBe(false);

    expect(await effectCounts()).toEqual(before);
    expect(await stockOf(store.rice.id)).toBe("8");
  });

  it("a chave de outro operador é recusada", async () => {
    const input = saleInput(store);
    await registerSale(store.user.id, input);

    const other = await createUser("Outro operador");
    const otherRegister = await openCashRegister(other.id);
    const result = await registerSale(other.id, { ...input, cashRegisterId: otherRegister.id });

    expect(result.success).toBe(false);
    expect((await effectCounts()).sales).toBe(1);
  });

  it("duas chamadas simultâneas com a mesma chave gravam uma única venda", async () => {
    const input = saleInput(store);
    const results = await Promise.all([
      registerSale(store.user.id, input),
      registerSale(store.user.id, input),
      registerSale(store.user.id, input),
    ]);

    for (const result of results) expect(result.success).toBe(true);
    const ids = new Set(results.map((r) => (r.success ? r.data.id : null)));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.success && !r.replayed)).toHaveLength(1);

    expect(await effectCounts()).toEqual({
      sales: 1,
      items: 2,
      movements: 2,
      receivables: 0,
      operations: 1,
    });
    expect(await stockOf(store.rice.id)).toBe("8");
    expect(await stockOf(store.cheese.id)).toBe("2");
  });

  it("chamadas simultâneas com o último saldo não ficam com erro de estoque na repetição", async () => {
    // Só há saldo para uma venda: a repetição concorrente precisa devolver a venda gravada,
    // e não "estoque insuficiente"
    const input = saleInput(store, {
      items: [{ productId: store.rice.id, quantity: 10 }],
      amountPaid: 100,
    });
    const results = await Promise.all([
      registerSale(store.user.id, input),
      registerSale(store.user.id, input),
    ]);

    expect(results.map((r) => r.success)).toEqual([true, true]);
    expect(await stockOf(store.rice.id)).toBe("0");
    expect((await effectCounts()).sales).toBe(1);
  });

  it("estoque insuficiente desfaz tudo, inclusive a chave, e a mesma chave vale depois", async () => {
    const input = saleInput(store, {
      items: [{ productId: store.rice.id, quantity: 11 }],
      amountPaid: 200,
    });
    const failed = await registerSale(store.user.id, input);

    expect(failed).toEqual({ success: false, error: 'Estoque insuficiente para "Arroz 5kg".' });
    expect(await effectCounts()).toEqual({
      sales: 0,
      items: 0,
      movements: 0,
      receivables: 0,
      operations: 0,
    });
    expect(await stockOf(store.rice.id)).toBe("10");

    await prisma.product.update({
      where: { id: store.rice.id },
      data: { currentStock: new Prisma.Decimal(20) },
    });
    const retried = await registerSale(store.user.id, input);
    expect(retried.success).toBe(true);
    if (retried.success) expect(retried.replayed).toBe(false);
    expect(await stockOf(store.rice.id)).toBe("9");
  });

  it("Fiado bloqueado pelo limite de crédito desfaz tudo, sem título nem chave", async () => {
    await prisma.storeSettings.create({
      data: {
        companyName: "Loja Teste",
        tradeName: "Loja Teste",
        onAccountCreditLimit: new Prisma.Decimal(40),
      },
    });
    const input = saleInput(store, {
      paymentMethod: PaymentMethod.ON_ACCOUNT,
      customerId: store.customer.id,
      amountPaid: undefined,
    });

    const result = await registerSale(store.user.id, input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Limite de crédito do Fiado excedido");
    expect(await effectCounts()).toEqual({
      sales: 0,
      items: 0,
      movements: 0,
      receivables: 0,
      operations: 0,
    });
    expect(await stockOf(store.rice.id)).toBe("10");
  });

  it("Fiado com título vencido desfaz tudo", async () => {
    await prisma.storeSettings.create({
      data: { companyName: "Loja Teste", tradeName: "Loja Teste", onAccountBlockOverdue: true },
    });
    const old = await prisma.sale.create({
      data: {
        total: new Prisma.Decimal(10),
        paymentMethod: PaymentMethod.ON_ACCOUNT,
        userId: store.user.id,
        customerId: store.customer.id,
        occurredAt: new Date("2026-01-10T15:00:00Z"),
      },
    });
    await prisma.receivable.create({
      data: {
        saleId: old.id,
        customerId: store.customer.id,
        amount: new Prisma.Decimal(10),
        dueDate: new Date("2026-02-10T03:00:00Z"),
      },
    });
    const before = await effectCounts();

    const result = await registerSale(
      store.user.id,
      saleInput(store, {
        paymentMethod: PaymentMethod.ON_ACCOUNT,
        customerId: store.customer.id,
        amountPaid: undefined,
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("título vencido");
    expect(await effectCounts()).toEqual(before);
  });

  it("venda no Fiado repetida gera um único título, com vencimento pela data da venda", async () => {
    await prisma.storeSettings.create({
      data: { companyName: "Loja Teste", tradeName: "Loja Teste", onAccountDueDays: 30 },
    });
    const input = saleInput(store, {
      paymentMethod: PaymentMethod.ON_ACCOUNT,
      customerId: store.customer.id,
      amountPaid: undefined,
    });

    const first = await registerSale(store.user.id, input);
    const second = await registerSale(store.user.id, input);
    expect(first.success && second.success).toBe(true);
    if (!first.success || !second.success) return;
    expect(second.data.id).toBe(first.data.id);
    expect(first.data.amountPaid).toBe(first.data.total);
    expect(first.data.change).toBe(0);

    const receivables = await prisma.receivable.findMany({ include: { sale: true } });
    expect(receivables).toHaveLength(1);
    const dueDate = receivables[0].dueDate!;
    const days = (dueDate.getTime() - receivables[0].sale.occurredAt.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThanOrEqual(30);
  });

  it("caixa fechado entre as tentativas: recusa e nunca grava no caixa aberto depois", async () => {
    const input = saleInput(store);
    await prisma.cashRegister.update({
      where: { id: store.cashRegister.id },
      data: { status: CashRegisterStatus.CLOSED, openUserId: null, closedAt: new Date() },
    });
    const newRegister = await openCashRegister(store.user.id);

    const result = await registerSale(store.user.id, input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("caixa desta venda não está aberto");
    expect(await prisma.sale.count({ where: { cashRegisterId: newRegister.id } })).toBe(0);
    expect((await effectCounts()).operations).toBe(0);
  });

  it("caixa de outro operador é recusado", async () => {
    const other = await createUser("Outro operador");
    const result = await registerSale(other.id, saleInput(store));
    expect(result.success).toBe(false);
    expect((await effectCounts()).sales).toBe(0);
  });

  it("chave que não é UUID é recusada antes de tocar no banco", async () => {
    for (const operationId of ["", "123", "não-é-uuid", `${randomUUID()}x`]) {
      const result = await registerSale(store.user.id, saleInput(store, { operationId }));
      expect(result).toEqual({
        success: false,
        error: "Identificador da venda inválido. Recarregue o PDV.",
      });
    }
    // Maiúsculas são a mesma chave
    const input = saleInput(store);
    await registerSale(store.user.id, input);
    const upper = await registerSale(store.user.id, {
      ...input,
      operationId: input.operationId.toUpperCase(),
    });
    expect(upper.success && upper.replayed).toBe(true);
    expect((await effectCounts()).sales).toBe(1);
  });

  it("mantém as regras de preço: o valor vem do banco, não do cliente", async () => {
    const result = await registerSale(
      store.user.id,
      saleInput(store, { discount: 2.95, amountPaid: 40 }),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.total).toBe(40);
    expect(result.data.items.map((i) => i.unitPrice).sort()).toEqual([10, 45.9]);

    const tooLow = await registerSale(store.user.id, saleInput(store, { amountPaid: 1 }));
    expect(tooLow).toEqual({
      success: false,
      error: "O valor recebido não pode ser menor que o total da venda.",
    });
  });
});
