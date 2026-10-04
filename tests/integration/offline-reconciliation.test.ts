import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CashRegisterStatus, PaymentMethod, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/authz";
import {
  acknowledgeIssue,
  approveConflict,
  discardConflict,
  syncOfflineOperation,
} from "@/lib/offline-sale";
import {
  createUser,
  offlineEffectCounts,
  offlineSale,
  prepareOffline,
  resetDatabase,
  seedStore,
  stockOf,
  type OfflineContext,
  type Store,
} from "./fixtures";

// Conciliação das vendas offline (issue #38, docs/OFFLINE.md seção 4): aprovar aplica a venda
// com a autoria e o caixa originais uma única vez; descartar exige motivo; ciência nas pendências.
// As Server Actions exigem "offline.reconcile"; a sessão do Auth.js e o cache do Next são simulados.
const { authorize, revalidatePath } = vi.hoisted(() => ({
  authorize: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({ authorize }));
vi.mock("next/cache", () => ({ revalidatePath }));

const actions = await import("@/actions/offline-reconciliation");

let store: Store;
let seller: SessionUser;
let manager: SessionUser;
let ctx: OfflineContext;

beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
  seller = { id: store.user.id, name: store.user.name, role: "SELLER" };
  const managerRow = await prisma.user.update({
    where: { id: (await createUser("Gerente")).id },
    data: { role: Role.MANAGER },
  });
  manager = { id: managerRow.id, name: managerRow.name, role: "MANAGER" };
  const { device, grant } = await prepareOffline(seller.id, store.cashRegister.id);
  ctx = {
    userId: seller.id,
    deviceId: device.id,
    grantId: grant.id,
    cashRegisterId: store.cashRegister.id,
  };
  authorize.mockReset();
  revalidatePath.mockReset();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Grava uma venda offline em conflito e devolve a chave. */
async function conflict(
  overrides: Record<string, unknown> = {},
  payload: Record<string, unknown> = {},
) {
  const op = offlineSale(store, ctx, overrides, payload);
  const result = await syncOfflineOperation(seller, op);
  expect(result.status).toBe("conflict");
  return op;
}

async function revokeDevice() {
  await prisma.offlineDevice.update({
    where: { id: ctx.deviceId },
    data: { revokedAt: new Date(), revokedById: manager.id },
  });
}

describe("approveConflict", () => {
  it("aplica a venda com a autoria e o caixa originais e registra quem decidiu", async () => {
    await revokeDevice();
    const op = await conflict();

    const result = await approveConflict(manager, op.operationId, "Aparelho conferido");
    expect(result).toMatchObject({ success: true });

    const operation = await prisma.syncOperation.findUniqueOrThrow({
      where: { id: op.operationId },
      include: { sale: true },
    });
    expect(operation).toMatchObject({
      status: "APPROVED",
      resolvedById: manager.id,
      resolutionNote: "Aparelho conferido",
    });
    expect(operation.appliedTxid).not.toBeNull();
    expect(operation.sale).toMatchObject({
      userId: seller.id,
      cashRegisterId: store.cashRegister.id,
    });
    expect(operation.sale?.total.toFixed(2)).toBe("42.95");
    expect(await stockOf(store.rice.id)).toBe("8");

    // O aparelho que reenviar recebe a venda aprovada
    const resend = await syncOfflineOperation(seller, op);
    expect(resend).toMatchObject({ status: "approved", replayed: true });
  });

  it("aprovar de novo, também ao mesmo tempo, não duplica a venda", async () => {
    await revokeDevice();
    const op = await conflict();

    const results = await Promise.all([
      approveConflict(manager, op.operationId),
      approveConflict(manager, op.operationId),
      approveConflict(manager, op.operationId),
    ]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(await offlineEffectCounts()).toMatchObject({ sales: 1, movements: 2, operations: 1 });
    expect(await approveConflict(manager, op.operationId)).toMatchObject({ success: false });
  });

  it("preço não vigente: grava o preço praticado com pendência de divergência", async () => {
    const op = await conflict(
      {},
      {
        items: [{ productId: store.rice.id, quantity: "2", unitPrice: "7.50" }],
        amountPaid: "15.00",
      },
    );
    expect(await approveConflict(manager, op.operationId)).toMatchObject({ success: true });
    const item = await prisma.saleItem.findFirstOrThrow();
    expect(item.unitPrice.toFixed(2)).toBe("7.50");
    const issue = await prisma.reconciliationIssue.findFirstOrThrow();
    expect(issue.type).toBe("PRICE_DIVERGENCE");
  });

  it("caixa fechado depois do conflito: a venda vai para ele com pendência pós-fechamento", async () => {
    await revokeDevice();
    const op = await conflict();
    await prisma.cashRegister.update({
      where: { id: store.cashRegister.id },
      data: {
        status: CashRegisterStatus.CLOSED,
        openUserId: null,
        closedAt: new Date(),
        expectedAmount: new Prisma.Decimal(100),
      },
    });

    expect(await approveConflict(manager, op.operationId)).toMatchObject({ success: true });
    const sale = await prisma.sale.findFirstOrThrow();
    expect(sale.cashRegisterId).toBe(store.cashRegister.id);
    const types = (await prisma.reconciliationIssue.findMany()).map((i) => i.type);
    expect(types).toEqual(["POST_CLOSING_SALE"]);
  });

  it("Fiado aprovado gera o título em Contas a Receber", async () => {
    const op = await conflict(
      {},
      { paymentMethod: PaymentMethod.ON_ACCOUNT, customerId: store.customer.id, amountPaid: null },
    );
    expect(await approveConflict(manager, op.operationId)).toMatchObject({ success: true });
    const receivable = await prisma.receivable.findFirstOrThrow();
    expect(receivable.customerId).toBe(store.customer.id);
    expect(receivable.amount.toFixed(2)).toBe("42.95");
  });

  it("quantidade fracionada fica a critério do gerente", async () => {
    const op = await conflict(
      {},
      {
        items: [{ productId: store.rice.id, quantity: "1.5", unitPrice: "10.00" }],
        amountPaid: "15.00",
      },
    );
    expect(await approveConflict(manager, op.operationId)).toMatchObject({ success: true });
    expect(await stockOf(store.rice.id)).toBe("8.5");
  });

  it("produto que não existe não pode ser aprovado; o conflito continua aberto", async () => {
    const op = await conflict(
      {},
      { items: [{ productId: "produto-inexistente", quantity: "1", unitPrice: "10.00" }] },
    );
    const result = await approveConflict(manager, op.operationId);
    expect(result).toMatchObject({ success: false });
    if (!result.success) expect(result.error).toContain("Descarte");
    const operation = await prisma.syncOperation.findUniqueOrThrow({
      where: { id: op.operationId },
    });
    expect(operation.status).toBe("CONFLICT");
    expect(await offlineEffectCounts()).toMatchObject({ sales: 0, movements: 0 });
  });
});

describe("discardConflict", () => {
  it("exige motivo e não grava efeitos; o reenvio recebe o descarte", async () => {
    await revokeDevice();
    const op = await conflict();

    expect(await discardConflict(manager, op.operationId, "  ")).toMatchObject({ success: false });
    expect(await discardConflict(manager, op.operationId, "Venda cancelada no balcão")).toEqual({
      success: true,
    });
    expect(await discardConflict(manager, op.operationId, "De novo")).toMatchObject({
      success: false,
    });
    expect(await approveConflict(manager, op.operationId)).toMatchObject({ success: false });

    const operation = await prisma.syncOperation.findUniqueOrThrow({
      where: { id: op.operationId },
    });
    expect(operation).toMatchObject({
      status: "DISCARDED",
      resolvedById: manager.id,
      resolutionNote: "Venda cancelada no balcão",
    });
    expect(await offlineEffectCounts()).toMatchObject({ sales: 0, movements: 0 });
    expect(await syncOfflineOperation(seller, op)).toMatchObject({
      status: "discarded",
      message: "Venda cancelada no balcão",
    });
  });

  it("chave inválida ou desconhecida é recusada", async () => {
    expect(await discardConflict(manager, "x", "Motivo qualquer")).toMatchObject({
      success: false,
    });
    expect(await discardConflict(manager, randomUUID(), "Motivo qualquer")).toMatchObject({
      success: false,
    });
  });
});

describe("acknowledgeIssue", () => {
  it("registra a ciência uma única vez", async () => {
    await syncOfflineOperation(
      seller,
      offlineSale(
        store,
        ctx,
        {},
        {
          amountPaid: "120.00",
          items: [{ productId: store.rice.id, quantity: "12", unitPrice: "10.00" }],
        },
      ),
    );
    const issue = await prisma.reconciliationIssue.findFirstOrThrow();
    expect(await acknowledgeIssue(manager, issue.id, "Ajuste feito no estoque")).toEqual({
      success: true,
    });
    expect(await acknowledgeIssue(manager, issue.id)).toMatchObject({ success: false });
    const after = await prisma.reconciliationIssue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(after).toMatchObject({ acknowledgedById: manager.id, note: "Ajuste feito no estoque" });
  });
});

describe("Server Actions de conciliação", () => {
  const forbidden = { ok: false, error: "Você não tem permissão para realizar esta ação." };

  it("sem offline.reconcile nada é lido nem alterado", async () => {
    await revokeDevice();
    const op = await conflict();
    authorize.mockResolvedValue(forbidden);

    expect(await actions.listOfflineConflicts()).toEqual({
      success: false,
      error: forbidden.error,
    });
    expect(await actions.listReconciliationIssues()).toMatchObject({ success: false });
    expect(await actions.approveOfflineConflict(op.operationId)).toMatchObject({ success: false });
    expect(await actions.discardOfflineConflict(op.operationId, "Motivo")).toMatchObject({
      success: false,
    });
    expect(await actions.acknowledgeReconciliationIssue("x")).toMatchObject({ success: false });
    expect(authorize).toHaveBeenCalledWith("offline.reconcile");
    expect(authorize.mock.calls.every(([permission]) => permission === "offline.reconcile")).toBe(
      true,
    );
    const operation = await prisma.syncOperation.findUniqueOrThrow({
      where: { id: op.operationId },
    });
    expect(operation.status).toBe("CONFLICT");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("gerente lista, aprova e revalida as telas", async () => {
    await revokeDevice();
    const op = await conflict();
    authorize.mockResolvedValue({ ok: true, user: manager });

    const list = await actions.listOfflineConflicts();
    expect(list).toMatchObject({ success: true, hasMore: false });
    if (!list.success) return;
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({
      operationId: op.operationId,
      reason: "DEVICE_REVOKED",
      userName: store.user.name,
      deviceName: "Chrome · Windows",
      total: 42.95,
      paymentMethod: "MONEY",
    });
    expect(list.data[0].items).toEqual(
      [
        { productId: store.rice.id, productName: "Arroz 5kg", quantity: 2, unitPrice: 10 },
        { productId: store.cheese.id, productName: "Queijo minas", quantity: 0.5, unitPrice: 45.9 },
      ].sort((a, b) => (a.productId < b.productId ? -1 : 1)),
    );

    expect(await actions.approveOfflineConflict(op.operationId)).toMatchObject({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/caixa");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/estoque");

    const resolved = await actions.listOfflineConflicts({ resolved: true });
    expect(resolved).toMatchObject({ success: true });
    if (resolved.success) {
      expect(resolved.data[0]).toMatchObject({
        status: "APPROVED",
        resolvedByName: "Gerente",
        saleCode: expect.any(Number),
      });
    }
    expect(await actions.listOfflineConflicts()).toMatchObject({ success: true, data: [] });
  });

  it("lista as pendências e registra a ciência", async () => {
    await prisma.product.update({
      where: { id: store.rice.id },
      data: { salePrice: new Prisma.Decimal(12) },
    });
    await syncOfflineOperation(seller, offlineSale(store, ctx));
    authorize.mockResolvedValue({ ok: true, user: manager });

    const list = await actions.listReconciliationIssues();
    expect(list).toMatchObject({ success: true });
    if (!list.success) return;
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({
      type: "PRICE_DIVERGENCE",
      productName: "Arroz 5kg",
      userName: store.user.name,
      details: { practicedPrice: "10.00", currentPrice: "12.00" },
    });

    expect(await actions.acknowledgeReconciliationIssue(list.data[0].id)).toEqual({
      success: true,
    });
    expect(await actions.listReconciliationIssues()).toMatchObject({ success: true, data: [] });
    const done = await actions.listReconciliationIssues({ acknowledged: true });
    expect(done).toMatchObject({ success: true });
    if (done.success) expect(done.data[0].acknowledgedByName).toBe("Gerente");
  });
});
