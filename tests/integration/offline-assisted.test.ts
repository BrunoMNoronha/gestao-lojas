import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CashRegisterStatus, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/authz";
import { approveConflict, syncOfflineOperation } from "@/lib/offline-sale";
import {
  offlinePendingForCashRegister,
  PendingReportError,
  reportPendingSales,
  STALE_REPORT_MS,
} from "@/lib/offline-pending";
import { computeCashSummary } from "@/lib/cash-register";
import {
  createUser,
  offlineEffectCounts,
  offlineSale,
  prepareOffline,
  resetDatabase,
  seedStore,
  type OfflineContext,
  type Store,
} from "./fixtures";

// Parte 3 da #38 (docs/OFFLINE.md seções 3.3 e 3.5): envio assistido por um gerente, informe de
// vendas pendentes por aparelho, aparelhos (listar e revogar) e ajuste pós-fechamento do caixa.
const { authorize, revalidatePath } = vi.hoisted(() => ({
  authorize: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({ authorize }));
vi.mock("next/cache", () => ({ revalidatePath }));

const reconciliation = await import("@/actions/offline-reconciliation");
const cashActions = await import("@/actions/cash-register");

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
  authorize.mockResolvedValue({ ok: true, user: manager });
  revalidatePath.mockReset();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("envio assistido por um gerente", () => {
  it("a venda de outro operador chega como conflito, sem efeito, com a autoria original", async () => {
    const op = offlineSale(store, ctx);
    const result = await syncOfflineOperation(manager, op);
    expect(result).toMatchObject({
      status: "conflict",
      replayed: false,
      reason: "ASSISTED_SUBMISSION",
    });
    expect(await offlineEffectCounts()).toMatchObject({ sales: 0, operations: 1, issues: 0 });
    const stored = await prisma.syncOperation.findUniqueOrThrow({ where: { id: op.operationId } });
    expect(stored).toMatchObject({
      status: "CONFLICT",
      userId: seller.id,
      submittedById: manager.id,
      conflictReason: "ASSISTED_SUBMISSION",
    });
    expect(stored.conflictMessage).toContain("Gerente");

    // Reenvio (pelo gerente ou pelo próprio operador): mesmo resultado, nada novo
    expect(await syncOfflineOperation(manager, op)).toMatchObject({
      status: "conflict",
      replayed: true,
    });
    expect(await syncOfflineOperation(seller, op)).toMatchObject({
      status: "conflict",
      replayed: true,
    });
    expect(await offlineEffectCounts()).toMatchObject({ sales: 0, operations: 1 });
  });

  it("outro motivo de conflito prevalece e registra quem enviou", async () => {
    const op = offlineSale(
      store,
      ctx,
      {},
      {
        items: [{ productId: store.rice.id, quantity: "1", unitPrice: "7.00" }],
        amountPaid: "7.00",
      },
    );
    const result = await syncOfflineOperation(manager, op);
    expect(result).toMatchObject({ status: "conflict", reason: "PRICE_NOT_VALID" });
    if (result.status !== "conflict") throw new Error("esperado conflito");
    expect(result.message).toContain("Enviada por Gerente");
  });

  it("aprovada, grava a venda uma vez com o operador e o caixa originais", async () => {
    const op = offlineSale(store, ctx);
    await syncOfflineOperation(manager, op);
    const approved = await approveConflict(manager, op.operationId, "Conferido com o operador");
    expect(approved).toMatchObject({ success: true });

    const sale = await prisma.sale.findFirstOrThrow();
    expect(sale.userId).toBe(seller.id);
    expect(sale.cashRegisterId).toBe(store.cashRegister.id);
    expect(await syncOfflineOperation(manager, op)).toMatchObject({
      status: "approved",
      replayed: true,
    });
    expect(await offlineEffectCounts()).toMatchObject({ sales: 1, operations: 1 });
  });

  it("vendedor não envia a venda de outro operador", async () => {
    const other = await createUser("Outro vendedor");
    const result = await syncOfflineOperation(
      { id: other.id, name: other.name, role: "SELLER" },
      offlineSale(store, ctx),
    );
    expect(result.status).toBe("forbidden");
    expect(await offlineEffectCounts()).toMatchObject({ operations: 0 });
  });

  it("a lista de conflitos mostra quem enviou", async () => {
    await syncOfflineOperation(manager, offlineSale(store, ctx));
    const list = await reconciliation.listOfflineConflicts();
    expect(list).toMatchObject({ success: true });
    if (!list.success) return;
    expect(list.data[0]).toMatchObject({
      reason: "ASSISTED_SUBMISSION",
      userName: store.user.name,
      submittedByName: "Gerente",
    });
  });
});

describe("informe de vendas pendentes e aviso do fechamento", () => {
  it("grava só as autorizações do próprio operador naquele aparelho", async () => {
    const other = await createUser("Outro operador");
    const otherCash = await prisma.cashRegister.create({
      data: { userId: other.id, openUserId: other.id, openingAmount: new Prisma.Decimal(0) },
    });
    const otherPrep = await prepareOffline(other.id, otherCash.id);

    const result = await reportPendingSales(seller, {
      deviceId: ctx.deviceId,
      grants: [
        { grantId: ctx.grantId, pending: 3 },
        { grantId: otherPrep.grant.id, pending: 9 },
      ],
    });
    expect(result).toEqual({ updated: 1 });
    const [mine, theirs] = await Promise.all([
      prisma.offlineGrant.findUniqueOrThrow({ where: { id: ctx.grantId } }),
      prisma.offlineGrant.findUniqueOrThrow({ where: { id: otherPrep.grant.id } }),
    ]);
    expect(mine.pendingCount).toBe(3);
    expect(mine.pendingReportedAt).not.toBeNull();
    expect(theirs.pendingCount).toBeNull();
  });

  it.each([
    [{ deviceId: "x", grants: [] }],
    [{ deviceId: randomUUID(), grants: "nada" }],
    [{ deviceId: randomUUID(), grants: [{ grantId: randomUUID(), pending: -1 }] }],
    [{ deviceId: randomUUID(), grants: [{ grantId: randomUUID(), pending: 1.5 }] }],
  ])("recusa informe inválido %#", async (body) => {
    await expect(reportPendingSales(seller, body)).rejects.toThrow(PendingReportError);
  });

  it("avisa de aparelho que nunca informou, com vendas ou sem contato; zero recente não avisa", async () => {
    const pending = (now?: Date) => offlinePendingForCashRegister(store.cashRegister.id, now);
    expect(await pending()).toEqual([
      expect.objectContaining({
        deviceId: ctx.deviceId,
        status: "never",
        pending: null,
        reportedAt: null,
      }),
    ]);

    await reportPendingSales(seller, {
      deviceId: ctx.deviceId,
      grants: [{ grantId: ctx.grantId, pending: 2 }],
    });
    expect(await pending()).toEqual([
      expect.objectContaining({
        deviceId: ctx.deviceId,
        status: "pending",
        pending: 2,
        userName: store.user.name,
      }),
    ]);

    await reportPendingSales(seller, {
      deviceId: ctx.deviceId,
      grants: [{ grantId: ctx.grantId, pending: 0 }],
    });
    expect(await pending()).toEqual([]);

    // Sem informe há mais de 10 minutos: pode estar sem internet com vendas guardadas
    const later = new Date(Date.now() + STALE_REPORT_MS + 60_000);
    expect(await pending(later)).toEqual([
      expect.objectContaining({ deviceId: ctx.deviceId, status: "stale", pending: 0 }),
    ]);

    // Aparelho revogado não entra no aviso
    await reportPendingSales(seller, {
      deviceId: ctx.deviceId,
      grants: [{ grantId: ctx.grantId, pending: 4 }],
    });
    await prisma.offlineDevice.update({
      where: { id: ctx.deviceId },
      data: { revokedAt: new Date() },
    });
    expect(await pending()).toEqual([]);
  });

  it("o caixa atual traz o aviso para o fechamento", async () => {
    authorize.mockResolvedValue({ ok: true, user: seller });
    await reportPendingSales(seller, {
      deviceId: ctx.deviceId,
      grants: [{ grantId: ctx.grantId, pending: 1 }],
    });
    const current = await cashActions.getCurrentCashRegister();
    expect(current?.offlinePending).toEqual([expect.objectContaining({ pending: 1 })]);
  });
});

describe("aparelhos", () => {
  it("lista e revoga uma única vez, registrando quem revogou", async () => {
    await reportPendingSales(seller, {
      deviceId: ctx.deviceId,
      grants: [{ grantId: ctx.grantId, pending: 2 }],
    });
    const list = await reconciliation.listOfflineDevices();
    expect(list).toMatchObject({ success: true });
    if (!list.success) return;
    expect(list.data).toEqual([
      expect.objectContaining({
        id: ctx.deviceId,
        operators: [store.user.name],
        pending: 2,
        revokedAt: null,
      }),
    ]);

    expect(await reconciliation.revokeOfflineDevice(ctx.deviceId)).toEqual({ success: true });
    expect(await reconciliation.revokeOfflineDevice(ctx.deviceId)).toMatchObject({
      success: false,
    });
    const device = await prisma.offlineDevice.findUniqueOrThrow({ where: { id: ctx.deviceId } });
    expect(device.revokedById).toBe(manager.id);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/sincronizacao");

    // Venda do aparelho revogado vira conflito
    expect(await syncOfflineOperation(seller, offlineSale(store, ctx))).toMatchObject({
      status: "conflict",
      reason: "DEVICE_REVOKED",
    });
  });

  it("exige offline.reconcile", async () => {
    authorize.mockResolvedValue({ ok: false, error: "Sem permissão.", code: "forbidden" });
    expect(await reconciliation.listOfflineDevices()).toEqual({
      success: false,
      error: "Sem permissão.",
    });
    expect(await reconciliation.revokeOfflineDevice(ctx.deviceId)).toMatchObject({
      success: false,
    });
    const device = await prisma.offlineDevice.findUniqueOrThrow({ where: { id: ctx.deviceId } });
    expect(device.revokedAt).toBeNull();
  });
});

describe("ajuste pós-fechamento", () => {
  async function closeCash(expected: string) {
    await prisma.cashRegister.update({
      where: { id: store.cashRegister.id },
      data: {
        status: CashRegisterStatus.CLOSED,
        openUserId: null,
        closedAt: new Date(),
        expectedAmount: new Prisma.Decimal(expected),
        countedAmount: new Prisma.Decimal(expected),
        difference: new Prisma.Decimal(0),
      },
    });
  }

  const pixRice = () =>
    offlineSale(
      store,
      ctx,
      {},
      {
        paymentMethod: "PIX",
        amountPaid: undefined,
        items: [{ productId: store.rice.id, quantity: "1", unitPrice: "10.00" }],
      },
    );

  it("venda sincronizada depois do fechamento fica fora do resumo e aparece à parte", async () => {
    expect((await syncOfflineOperation(seller, offlineSale(store, ctx))).status).toBe("applied");
    await closeCash("142.95");
    expect((await syncOfflineOperation(seller, pixRice())).status).toBe("applied");

    const { summary } = await computeCashSummary(prisma, store.cashRegister.id);
    expect(summary.salesCount).toBe(1);
    expect(summary.expectedCash).toBe(142.95);

    authorize.mockResolvedValue({ ok: true, user: seller });
    const detail = await cashActions.getCashRegisterDetail(store.cashRegister.id);
    expect(detail?.summary.salesCount).toBe(1);
    expect(detail?.postClosing).toMatchObject({ count: 1, total: 10, cash: 0 });
    expect(detail?.postClosing?.sales[0]).toMatchObject({ method: "PIX", total: 10 });
  });

  it("conflito enviado antes do fechamento e aprovado depois também é ajuste", async () => {
    // A venda aprovada guarda como recebimento a data do envio, anterior ao fechamento
    const op = pixRice();
    await syncOfflineOperation(manager, op);
    await closeCash("100.00");
    expect(await approveConflict(manager, op.operationId)).toMatchObject({ success: true });

    authorize.mockResolvedValue({ ok: true, user: seller });
    const detail = await cashActions.getCashRegisterDetail(store.cashRegister.id);
    expect(detail?.summary.salesCount).toBe(0);
    expect(detail?.summary.expectedCash).toBe(100);
    expect(detail?.postClosing).toMatchObject({ count: 1, total: 10 });
  });

  it("caixa sem venda tardia não tem ajuste", async () => {
    authorize.mockResolvedValue({ ok: true, user: seller });
    await syncOfflineOperation(seller, offlineSale(store, ctx));
    const detail = await cashActions.getCashRegisterDetail(store.cashRegister.id);
    expect(detail?.postClosing).toBeNull();
    expect(detail?.summary.salesCount).toBe(1);
  });
});
