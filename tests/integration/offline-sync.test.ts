import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CashRegisterStatus, PaymentMethod, Prisma, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/authz";
import { registerSale } from "@/lib/create-sale";
import {
  PRICE_WINDOW_TOLERANCE_MS,
  syncOfflineOperation,
  type OfflineOperationResult,
} from "@/lib/offline-sale";
import {
  createUser,
  offlineEffectCounts,
  offlineSale,
  openCashRegister,
  prepareOffline,
  resetDatabase,
  saleInput,
  seedStore,
  stockOf,
  type OfflineContext,
  type Store,
} from "./fixtures";

// Sincronização das vendas offline no servidor (issue #38, docs/OFFLINE.md seções 3 a 5):
// idempotência, políticas de preço, estoque, caixa e data, conflitos sem efeito e atomicidade.

let store: Store;
let user: SessionUser;
let ctx: OfflineContext;
let grantIssuedAt: Date;

beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
  user = { id: store.user.id, name: store.user.name, role: "SELLER" };
  grantIssuedAt = new Date();
  const { device, grant } = await prepareOffline(user.id, store.cashRegister.id, grantIssuedAt);
  ctx = {
    userId: user.id,
    deviceId: device.id,
    grantId: grant.id,
    cashRegisterId: store.cashRegister.id,
  };
});

afterAll(async () => {
  await prisma.$disconnect();
});

function expectApplied(result: OfflineOperationResult) {
  expect(result.status).toBe("applied");
  if (result.status !== "applied") throw new Error(JSON.stringify(result));
  return result;
}

function expectConflict(result: OfflineOperationResult, reason: string) {
  expect(result).toMatchObject({ status: "conflict", reason });
}

async function issueTypes() {
  const issues = await prisma.reconciliationIssue.findMany({ orderBy: { type: "asc" } });
  return issues.map((i) => i.type);
}

describe("venda offline aplicada", () => {
  it("grava venda, itens, estoque, movimentações e a operação com payload e txid", async () => {
    const op = offlineSale(store, ctx);
    const result = expectApplied(await syncOfflineOperation(user, op));

    expect(result.replayed).toBe(false);
    expect(result.appliedTxid).toMatch(/^\d+$/);
    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id: result.sale.id },
      include: { items: { orderBy: { unitPrice: "asc" } } },
    });
    expect(sale.total.toFixed(2)).toBe("42.95");
    expect(sale.userId).toBe(user.id);
    expect(sale.cashRegisterId).toBe(store.cashRegister.id);
    // Aconteceu no aparelho; chegou depois
    expect(sale.occurredAt.toISOString()).toBe(op.occurredAt);
    expect(sale.createdAt.getTime()).toBeGreaterThanOrEqual(sale.occurredAt.getTime());
    expect(sale.items.map((i) => [i.quantity.toFixed(3), i.unitPrice.toFixed(2)])).toEqual([
      ["2.000", "10.00"],
      ["0.500", "45.90"],
    ]);

    const operation = await prisma.syncOperation.findUniqueOrThrow({
      where: { id: op.operationId },
    });
    expect(operation).toMatchObject({
      status: "APPLIED",
      saleId: sale.id,
      deviceId: ctx.deviceId,
      grantId: ctx.grantId,
      cashRegisterId: ctx.cashRegisterId,
      conflictReason: null,
    });
    expect(operation.appliedTxid?.toString()).toBe(result.appliedTxid);
    expect(operation.payload).toMatchObject({ kind: "sale.create", discount: "0.00" });

    expect(await offlineEffectCounts()).toEqual({
      sales: 1,
      items: 2,
      movements: 2,
      receivables: 0,
      operations: 1,
      issues: 0,
    });
    expect(await stockOf(store.rice.id)).toBe("8");
    expect(await stockOf(store.cheese.id)).toBe("2");
    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { productId: store.rice.id },
    });
    expect(movement.reason).toBe(`Venda #${sale.code} (offline)`);
  });

  it("o txid da venda fica abaixo do limite da próxima leitura da cópia local", async () => {
    const result = expectApplied(await syncOfflineOperation(user, offlineSale(store, ctx)));
    const { readOfflineSnapshot } = await import("@/lib/offline-snapshot");
    const snapshot = await readOfflineSnapshot(user);
    expect(BigInt(snapshot.watermark)).toBeGreaterThan(BigInt(result.appliedTxid));
    const rice = snapshot.products.find((p) => p.id === store.rice.id);
    expect(rice && !rice.deleted && rice.currentStock).toBe("8.000");
  });

  it("mantém a precisão de dinheiro, desconto, troco e quantidades fracionadas", async () => {
    const result = expectApplied(
      await syncOfflineOperation(
        user,
        offlineSale(
          store,
          ctx,
          {},
          {
            discount: "0.28",
            amountPaid: "20.00",
            items: [{ productId: store.cheese.id, quantity: "0.333", unitPrice: "45.90" }],
          },
        ),
      ),
    );
    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id: result.sale.id },
      include: { items: true },
    });
    // 0,333 × 45,90 = 15,2847 → 15,28; menos 0,28 de desconto
    expect(sale.items[0].subtotal.toFixed(2)).toBe("15.28");
    expect(sale.discount.toFixed(2)).toBe("0.28");
    expect(sale.total.toFixed(2)).toBe("15.00");
    expect(await stockOf(store.cheese.id)).toBe("2.167");
  });
});

describe("idempotência", () => {
  it("reenvio (resposta perdida, lote repetido) devolve o resultado sem novos efeitos", async () => {
    const op = offlineSale(store, ctx);
    const first = expectApplied(await syncOfflineOperation(user, op));
    // Mesmo conteúdo com itens em outra ordem e quantidade escrita de outro jeito
    const same = structuredClone(op);
    same.payload.items = [
      { productId: store.cheese.id, quantity: "0.50", unitPrice: "45.9" },
      { productId: store.rice.id, quantity: "2.000", unitPrice: "10" },
    ];
    const second = expectApplied(await syncOfflineOperation(user, op));
    const third = expectApplied(await syncOfflineOperation(user, same));

    expect(second.replayed && third.replayed).toBe(true);
    expect(second.sale).toEqual(first.sale);
    expect(third.sale).toEqual(first.sale);
    expect(second.appliedTxid).toBe(first.appliedTxid);
    expect(await offlineEffectCounts()).toMatchObject({ sales: 1, movements: 2, operations: 1 });
    expect(await stockOf(store.rice.id)).toBe("8");
  });

  it("mesma chave com outros dados é recusada sem efeito", async () => {
    const op = offlineSale(store, ctx);
    expectApplied(await syncOfflineOperation(user, op));
    const changed = structuredClone(op);
    changed.payload.discount = "1.00";

    const result = await syncOfflineOperation(user, changed);
    expect(result).toMatchObject({ status: "protocol_error", operationId: op.operationId });
    expect(await offlineEffectCounts()).toMatchObject({ sales: 1, operations: 1 });
  });

  it("envios simultâneos da mesma operação (duas abas) geram uma única venda", async () => {
    const op = offlineSale(store, ctx);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => syncOfflineOperation(user, structuredClone(op))),
    );

    const saleIds = new Set(results.map((r) => expectApplied(r).sale.id));
    expect(saleIds.size).toBe(1);
    expect(results.filter((r) => r.status === "applied" && !r.replayed)).toHaveLength(1);
    expect(await offlineEffectCounts()).toMatchObject({ sales: 1, movements: 2, operations: 1 });
    expect(await stockOf(store.rice.id)).toBe("8");
  });

  it("conflito reenviado devolve o mesmo conflito, sem gravar de novo", async () => {
    const op = offlineSale(store, ctx, {}, { paymentMethod: PaymentMethod.ON_ACCOUNT });
    expectConflict(await syncOfflineOperation(user, op), "ON_ACCOUNT_OFFLINE");
    const again = await syncOfflineOperation(user, op);
    expect(again).toMatchObject({ status: "conflict", replayed: true });
    expect(await prisma.syncOperation.count()).toBe(1);
  });

  it("falha no meio desfaz tudo e a mesma chave pode ser enviada de novo", async () => {
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_movement() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'falha simulada'; END; $$`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fail_movement BEFORE INSERT ON "StockMovement"
      FOR EACH ROW EXECUTE FUNCTION test_fail_movement()`);
    const op = offlineSale(
      store,
      ctx,
      {},
      {
        items: [{ productId: store.rice.id, quantity: "12", unitPrice: "10.00" }],
        amountPaid: "120.00",
      },
    );
    try {
      const failed = await syncOfflineOperation(user, op);
      expect(failed).toMatchObject({ status: "retry", operationId: op.operationId });
      expect(await offlineEffectCounts()).toEqual({
        sales: 0,
        items: 0,
        movements: 0,
        receivables: 0,
        operations: 0,
        issues: 0,
      });
      expect(await stockOf(store.rice.id)).toBe("10");
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER test_fail_movement ON "StockMovement"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION test_fail_movement()`);
    }

    expectApplied(await syncOfflineOperation(user, op));
    expect(await offlineEffectCounts()).toMatchObject({ sales: 1, operations: 1, issues: 1 });
    expect(await stockOf(store.rice.id)).toBe("-2");
  });
});

describe("preço praticado (seção 3.1)", () => {
  it("preço que vigorou no período é aceito, com pendência de divergência", async () => {
    await prisma.product.update({
      where: { id: store.rice.id },
      data: { salePrice: new Prisma.Decimal(12) },
    });
    const result = expectApplied(await syncOfflineOperation(user, offlineSale(store, ctx)));

    const item = await prisma.saleItem.findFirstOrThrow({
      where: { saleId: result.sale.id, productId: store.rice.id },
    });
    expect(item.unitPrice.toFixed(2)).toBe("10.00");
    const issue = await prisma.reconciliationIssue.findFirstOrThrow();
    expect(issue).toMatchObject({ type: "PRICE_DIVERGENCE", productId: store.rice.id });
    expect(issue.details).toEqual({
      practicedPrice: "10.00",
      currentPrice: "12.00",
      quantity: "2.000",
    });
  });

  it("preço que nunca existiu vira conflito sem efeito, com o payload guardado", async () => {
    const op = offlineSale(
      store,
      ctx,
      {},
      { items: [{ productId: store.rice.id, quantity: "2", unitPrice: "1.00" }] },
    );
    const result = await syncOfflineOperation(user, op);

    expectConflict(result, "PRICE_NOT_VALID");
    const operation = await prisma.syncOperation.findUniqueOrThrow({
      where: { id: op.operationId },
    });
    expect(operation).toMatchObject({ status: "CONFLICT", saleId: null, appliedTxid: null });
    expect(operation.conflictMessage).toContain("Arroz 5kg");
    expect(operation.payload).toMatchObject({ items: [[store.rice.id, "2.000", "1.00"]] });
    expect(await offlineEffectCounts()).toMatchObject({ sales: 0, movements: 0, issues: 0 });
    expect(await stockOf(store.rice.id)).toBe("10");
  });

  it("vale o preço vigente no início do período (com a tolerância) e os seguintes", async () => {
    const issued = grantIssuedAt.getTime();
    await prisma.productPrice.deleteMany({ where: { productId: store.rice.id } });
    await prisma.productPrice.createMany({
      data: [
        {
          productId: store.rice.id,
          salePrice: new Prisma.Decimal(8),
          validFrom: new Date(issued - 3 * 3600_000),
        },
        {
          productId: store.rice.id,
          salePrice: new Prisma.Decimal(9),
          validFrom: new Date(issued - PRICE_WINDOW_TOLERANCE_MS - 60_000),
        },
        {
          productId: store.rice.id,
          salePrice: new Prisma.Decimal(10),
          validFrom: new Date(issued - 60_000),
        },
      ],
    });
    const sell = (price: string) =>
      syncOfflineOperation(
        user,
        offlineSale(
          store,
          ctx,
          {},
          {
            items: [{ productId: store.rice.id, quantity: "1", unitPrice: price }],
          },
        ),
      );

    expectApplied(await sell("9.00"));
    expectApplied(await sell("10.00"));
    expectConflict(await sell("8.00"), "PRICE_NOT_VALID");
  });
});

describe("estoque (seção 3.2)", () => {
  it("venda offline sem saldo é aceita, deixa o estoque negativo e gera pendência", async () => {
    const result = expectApplied(
      await syncOfflineOperation(
        user,
        offlineSale(
          store,
          ctx,
          {},
          {
            amountPaid: "120.00",
            items: [{ productId: store.rice.id, quantity: "12", unitPrice: "10.00" }],
          },
        ),
      ),
    );
    expect(await stockOf(store.rice.id)).toBe("-2");
    const issue = await prisma.reconciliationIssue.findFirstOrThrow();
    expect(issue).toMatchObject({
      type: "NEGATIVE_STOCK",
      saleId: result.sale.id,
      productId: store.rice.id,
    });
    expect(issue.details).toEqual({ quantity: "12.000", stockAfter: "-2.000" });

    // A venda online continua recusando sem saldo
    const online = await registerSale(
      user.id,
      saleInput(store, { items: [{ productId: store.rice.id, quantity: 1 }], amountPaid: 10 }),
    );
    expect(online).toMatchObject({ success: false });
    expect(await stockOf(store.rice.id)).toBe("-2");
  });

  it("dois terminais vendendo o mesmo saldo: as duas vendas entram e o excesso vira pendência", async () => {
    const other = await createUser("Outro operador");
    const otherCash = await openCashRegister(other.id);
    const prep = await prepareOffline(other.id, otherCash.id);
    const otherUser: SessionUser = { id: other.id, name: other.name, role: "SELLER" };
    const otherCtx = {
      userId: other.id,
      deviceId: prep.device.id,
      grantId: prep.grant.id,
      cashRegisterId: otherCash.id,
    };
    const eight = {
      amountPaid: "80.00",
      items: [{ productId: store.rice.id, quantity: "8", unitPrice: "10.00" }],
    };

    const results = await Promise.all([
      syncOfflineOperation(user, offlineSale(store, ctx, {}, eight)),
      syncOfflineOperation(otherUser, offlineSale(store, otherCtx, {}, eight)),
    ]);
    results.forEach(expectApplied);
    expect(await stockOf(store.rice.id)).toBe("-6");
    expect(await issueTypes()).toEqual(["NEGATIVE_STOCK"]);
  });

  it("produto excluído depois da venda continua valendo", async () => {
    await prisma.product.update({ where: { id: store.rice.id }, data: { deletedAt: new Date() } });
    expectApplied(await syncOfflineOperation(user, offlineSale(store, ctx)));
    expect(await stockOf(store.rice.id)).toBe("8");
  });

  it("produto que nunca existiu vira conflito", async () => {
    const op = offlineSale(
      store,
      ctx,
      {},
      { items: [{ productId: "produto-inexistente", quantity: "1", unitPrice: "10.00" }] },
    );
    expectConflict(await syncOfflineOperation(user, op), "PRODUCT_NOT_FOUND");
  });
});

describe("caixa original (seção 3.3)", () => {
  it("venda que chega depois do fechamento vai para o caixa original, sem mudar o resumo", async () => {
    await prisma.cashRegister.update({
      where: { id: store.cashRegister.id },
      data: {
        status: CashRegisterStatus.CLOSED,
        openUserId: null,
        closedAt: new Date(),
        expectedAmount: new Prisma.Decimal(100),
        countedAmount: new Prisma.Decimal(100),
        difference: new Prisma.Decimal(0),
      },
    });
    // O operador já abriu outro caixa: a venda não pode cair nele
    const newCash = await openCashRegister(user.id);

    const result = expectApplied(await syncOfflineOperation(user, offlineSale(store, ctx)));
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: result.sale.id } });
    expect(sale.cashRegisterId).toBe(store.cashRegister.id);
    expect(sale.cashRegisterId).not.toBe(newCash.id);

    const closed = await prisma.cashRegister.findUniqueOrThrow({
      where: { id: store.cashRegister.id },
    });
    expect(closed.expectedAmount?.toFixed(2)).toBe("100.00");
    const issue = await prisma.reconciliationIssue.findFirstOrThrow();
    expect(issue.type).toBe("POST_CLOSING_SALE");
    expect(issue.details).toMatchObject({ total: "42.95", cashAmount: "42.95" });
  });

  it("caixa de outro operador vira conflito", async () => {
    const other = await createUser("Outro operador");
    const otherCash = await openCashRegister(other.id);
    const op = offlineSale(store, ctx, { cashRegisterId: otherCash.id });
    expectConflict(await syncOfflineOperation(user, op), "CASH_REGISTER_MISMATCH");
    expect(await offlineEffectCounts()).toMatchObject({ sales: 0, operations: 1 });
  });

  it("caixa inexistente vira conflito e o id enviado fica no payload", async () => {
    const op = offlineSale(store, ctx, { cashRegisterId: "caixa-inexistente" });
    expectConflict(await syncOfflineOperation(user, op), "CASH_REGISTER_MISMATCH");
    const operation = await prisma.syncOperation.findUniqueOrThrow({
      where: { id: op.operationId },
    });
    expect(operation.cashRegisterId).toBeNull();
    expect(operation.payload).toMatchObject({ cashRegisterId: "caixa-inexistente" });
  });
});

describe("autorização offline e aparelho (seção 3.5)", () => {
  it("aparelho revogado vira conflito", async () => {
    await prisma.offlineDevice.update({
      where: { id: ctx.deviceId },
      data: { revokedAt: new Date(), revokedById: user.id },
    });
    expectConflict(await syncOfflineOperation(user, offlineSale(store, ctx)), "DEVICE_REVOKED");
    expect(await stockOf(store.rice.id)).toBe("10");
  });

  it("autorização inexistente ou de outro aparelho vira conflito", async () => {
    expectConflict(
      await syncOfflineOperation(user, offlineSale(store, ctx, { grantId: randomUUID() })),
      "GRANT_MISMATCH",
    );
    const otherDevice = await prepareOffline(user.id, store.cashRegister.id);
    expectConflict(
      await syncOfflineOperation(user, offlineSale(store, ctx, { grantId: otherDevice.grant.id })),
      "GRANT_MISMATCH",
    );
    expect(await offlineEffectCounts()).toMatchObject({ sales: 0, operations: 2 });
  });

  it("autorização vencida na hora do envio não é conflito; a data fica limitada à validade", async () => {
    // Autorização emitida há 13 horas (venceu há 1 hora); venda informada como de agora
    const issuedAt = new Date(Date.now() - 13 * 3600_000);
    await prisma.cashRegister.update({
      where: { id: store.cashRegister.id },
      data: { openedAt: new Date(issuedAt.getTime() - 60_000) },
    });
    await prisma.productPrice.updateMany({
      where: {},
      data: { validFrom: new Date(issuedAt.getTime() - 3600_000) },
    });
    const prep = await prepareOffline(user.id, store.cashRegister.id, issuedAt);
    const op = offlineSale(store, { ...ctx, deviceId: prep.device.id, grantId: prep.grant.id });

    const result = expectApplied(await syncOfflineOperation(user, op));
    expect(result.sale.occurredAt).toBe(prep.grant.expiresAt.toISOString());
    const issue = await prisma.reconciliationIssue.findFirstOrThrow();
    expect(issue.type).toBe("DATE_ADJUSTED");
    expect(issue.details).toEqual({
      reportedAt: op.occurredAt,
      adjustedAt: prep.grant.expiresAt.toISOString(),
    });
  });

  it("data anterior à abertura do caixa é ajustada para o início do período", async () => {
    const op = offlineSale(store, ctx, {
      occurredAt: new Date(Date.now() - 48 * 3600_000).toISOString(),
    });
    const result = expectApplied(await syncOfflineOperation(user, op));
    const lower = Math.max(store.cashRegister.openedAt.getTime(), grantIssuedAt.getTime());
    expect(result.sale.occurredAt).toBe(new Date(lower).toISOString());
    expect(await issueTypes()).toEqual(["DATE_ADJUSTED"]);
  });

  it("operação de outro operador é recusada sem gravar nada", async () => {
    const other = await createUser("Outro operador");
    const result = await syncOfflineOperation(
      { id: other.id, name: other.name, role: "MANAGER" },
      offlineSale(store, ctx),
    );
    expect(result.status).toBe("forbidden");
    expect(await offlineEffectCounts()).toMatchObject({ sales: 0, operations: 0 });
  });
});

describe("pagamento, cliente e valores", () => {
  it("Fiado offline vira conflito", async () => {
    const op = offlineSale(
      store,
      ctx,
      {},
      { paymentMethod: PaymentMethod.ON_ACCOUNT, customerId: store.customer.id, amountPaid: null },
    );
    expectConflict(await syncOfflineOperation(user, op), "ON_ACCOUNT_OFFLINE");
    expect(await offlineEffectCounts()).toMatchObject({ sales: 0, receivables: 0 });
  });

  it("PIX e cartão são aceitos como declarados", async () => {
    for (const method of [PaymentMethod.PIX, PaymentMethod.CREDIT_CARD, PaymentMethod.DEBIT_CARD]) {
      expectApplied(
        await syncOfflineOperation(
          user,
          offlineSale(store, ctx, {}, { paymentMethod: method, amountPaid: null }),
        ),
      );
    }
    expect(await offlineEffectCounts()).toMatchObject({ sales: 3 });
  });

  it("quantidade fracionada em produto vendido por unidade vira conflito", async () => {
    expect(store.rice.unit).toBe(Unit.UN);
    const op = offlineSale(
      store,
      ctx,
      {},
      { items: [{ productId: store.rice.id, quantity: "1.5", unitPrice: "10.00" }] },
    );
    expectConflict(await syncOfflineOperation(user, op), "FRACTIONAL_QUANTITY");
  });

  it("desconto maior que o subtotal e dinheiro insuficiente viram conflito", async () => {
    expectConflict(
      await syncOfflineOperation(user, offlineSale(store, ctx, {}, { discount: "50.00" })),
      "INVALID_AMOUNTS",
    );
    expectConflict(
      await syncOfflineOperation(user, offlineSale(store, ctx, {}, { amountPaid: "40.00" })),
      "INVALID_AMOUNTS",
    );
    expect(await offlineEffectCounts()).toMatchObject({ sales: 0, operations: 2 });
  });

  it("cliente excluído depois da venda: aceita, com pendência informativa", async () => {
    await prisma.customer.update({
      where: { id: store.customer.id },
      data: { deletedAt: new Date() },
    });
    const result = expectApplied(
      await syncOfflineOperation(
        user,
        offlineSale(store, ctx, {}, { customerId: store.customer.id }),
      ),
    );
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: result.sale.id } });
    expect(sale.customerId).toBe(store.customer.id);
    expect(await issueTypes()).toEqual(["DELETED_CUSTOMER"]);
  });

  it("cliente que nunca existiu vira conflito", async () => {
    expectConflict(
      await syncOfflineOperation(user, offlineSale(store, ctx, {}, { customerId: "cliente-x" })),
      "CUSTOMER_NOT_FOUND",
    );
  });

  it("formato inválido é recusado sem gravar (decimais precisam vir como texto)", async () => {
    const cases = [
      offlineSale(
        store,
        ctx,
        {},
        { items: [{ productId: store.rice.id, quantity: 2, unitPrice: "10.00" }] },
      ),
      offlineSale(store, ctx, {}, { discount: 0.5 }),
      offlineSale(store, ctx, { operationId: "nao-e-uuid" }),
      offlineSale(store, ctx, { protocolVersion: 2 }),
      offlineSale(store, ctx, { occurredAt: "ontem" }),
      offlineSale(store, ctx, {}, { items: [] }),
    ];
    for (const op of cases) {
      expect((await syncOfflineOperation(user, op)).status).toBe("invalid");
    }
    expect(await offlineEffectCounts()).toMatchObject({ sales: 0, operations: 0 });
  });
});
