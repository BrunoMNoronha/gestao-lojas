import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CashRegisterStatus, MovementType, PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { registerSale } from "@/lib/create-sale";
import { computeCashSummary } from "@/lib/cash-register";
import {
  createUser,
  openCashRegister,
  resetDatabase,
  saleInput,
  seedStore,
  stockOf,
  type Store,
} from "./fixtures";

// Estorno da venda inteira (src/lib/reverse-sale.ts) pela Server Action reverseSaleAction, que
// autoriza com "sales.reverse". A sessão do Auth.js é simulada.
const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("@/lib/authz", () => ({ authorize }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

const { reverseSaleAction, getSaleDetail } = await import("@/actions/sales");
const { getSalesReport } = await import("@/actions/reports");
const { getReceivablesSummary, registerReceivablePayment } = await import("@/actions/receivables");

let store: Store;

const loginAs = (id: string, role: "ADMIN" | "MANAGER" | "SELLER") =>
  authorize.mockResolvedValue({ ok: true, user: { id, name: "Sessão", role } });

async function sell(overrides: Parameters<typeof saleInput>[1] = {}) {
  const result = await registerSale(store.user.id, saleInput(store, overrides));
  if (!result.success) throw new Error(result.error);
  return result.data;
}

const fiado = { paymentMethod: PaymentMethod.ON_ACCOUNT, customerId: null, amountPaid: undefined };

async function sellOnAccount() {
  return sell({ ...fiado, customerId: store.customer.id });
}

async function expectedCash(cashRegisterId: string) {
  const { expectedCash } = await prisma.$transaction((tx) =>
    computeCashSummary(tx, cashRegisterId),
  );
  return expectedCash.toString();
}

async function closeRegister(cashRegisterId: string) {
  await prisma.cashRegister.update({
    where: { id: cashRegisterId },
    data: { status: CashRegisterStatus.CLOSED, openUserId: null, closedAt: new Date() },
  });
}

async function manager() {
  const user = await createUser("Gerente");
  loginAs(user.id, "MANAGER");
  return user;
}

const reverse = (saleId: string, reason = "Cliente desistiu") =>
  reverseSaleAction({ saleId, reason });

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
  authorize.mockReset();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("reverseSaleAction", () => {
  it("exige a permissão sales.reverse", async () => {
    const sale = await sell();
    authorize.mockResolvedValue({ ok: false, error: "Sem permissão." });

    expect(await reverse(sale.id)).toEqual({ success: false, error: "Sem permissão." });
    expect(authorize).toHaveBeenCalledWith("sales.reverse");
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).reversedAt).toBeNull();
  });

  it("exige motivo", async () => {
    const sale = await sell();
    await manager();

    expect(await reverse(sale.id, " a ")).toMatchObject({ success: false });
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).reversedAt).toBeNull();
  });

  it("dinheiro com o caixa da venda aberto: devolve estoque e tira a venda do esperado", async () => {
    const sale = await sell();
    expect(await expectedCash(store.cashRegister.id)).toBe("142.95");
    const reverser = await manager();

    const result = await reverse(sale.id);

    expect(result).toEqual({
      success: true,
      data: { code: sale.code, cashRefund: 42.95, cashRefundFrom: "SALE_REGISTER" },
    });
    expect(await stockOf(store.rice.id)).toBe("10");
    expect(await stockOf(store.cheese.id)).toBe("2.5");
    const movements = await prisma.stockMovement.findMany({
      where: { type: MovementType.IN, reason: `Estorno da venda #${sale.code}` },
    });
    expect(movements).toHaveLength(2);
    expect(movements.every((m) => m.userId === reverser.id)).toBe(true);
    expect(await expectedCash(store.cashRegister.id)).toBe("100");
    expect(await prisma.cashMovement.count()).toBe(0);

    const saved = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(saved).toMatchObject({
      reversedById: reverser.id,
      reversalReason: "Cliente desistiu",
      reversedInRegister: true,
    });

    const { summary } = await prisma.$transaction((tx) =>
      computeCashSummary(tx, store.cashRegister.id),
    );
    expect(summary).toMatchObject({ salesCount: 0, reversedCount: 1, reversedTotal: 42.95 });
  });

  it("sai dos totais do relatório, mas continua na lista marcada", async () => {
    const kept = await sell({ paymentMethod: PaymentMethod.PIX, amountPaid: undefined });
    const reversed = await sell();
    await manager();
    await reverse(reversed.id);

    const day = todayKey();
    const report = await getSalesReport({ from: day, to: day });

    expect(report.success).toBe(true);
    if (!report.success || !report.data) return;
    expect(report.data.totals).toMatchObject({ total: 42.95, count: 1 });
    expect(report.data.byMethod).toEqual([{ method: "PIX", total: 42.95, count: 1 }]);
    expect(report.data.daily).toEqual([{ day, total: 42.95, count: 1 }]);
    expect(report.data.salesTotal).toBe(2);
    expect(report.data.sales.map((s) => [s.id, s.reversed])).toEqual([
      [reversed.id, true],
      [kept.id, false],
    ]);
  });

  it("dinheiro com o caixa da venda fechado: sangria no caixa de quem estorna", async () => {
    const sale = await sell();
    await closeRegister(store.cashRegister.id);
    const closedBefore = await expectedCash(store.cashRegister.id);
    const reverser = await manager();

    // Sem caixa aberto não há de onde tirar o dinheiro
    expect(await reverse(sale.id)).toMatchObject({ success: false });

    const own = await openCashRegister(reverser.id);
    const result = await reverse(sale.id);

    expect(result).toMatchObject({
      success: true,
      data: { cashRefund: 42.95, cashRefundFrom: "OWN_REGISTER" },
    });
    expect(await expectedCash(store.cashRegister.id)).toBe(closedBefore);
    expect(await expectedCash(own.id)).toBe("57.05");
    const withdrawal = await prisma.cashMovement.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(withdrawal).toMatchObject({
      cashRegisterId: own.id,
      type: "WITHDRAWAL",
      reason: `Estorno da venda #${sale.code}`,
    });
    expect(withdrawal.amount.toString()).toBe("42.95");

    const detail = await getSaleDetail(sale.id);
    expect(detail?.reversal).toMatchObject({
      inRegister: false,
      refunds: [{ amount: 42.95, registerUserName: "Gerente" }],
    });
    expect(detail?.canReverse).toBe(false);
  });

  it("recusa quando a gaveta de quem estorna não tem o dinheiro", async () => {
    const sale = await sell();
    await closeRegister(store.cashRegister.id);
    const reverser = await manager();
    await prisma.cashRegister.create({
      data: { userId: reverser.id, openUserId: reverser.id, openingAmount: new Prisma.Decimal(10) },
    });

    expect(await reverse(sale.id)).toMatchObject({ success: false });
    expect(await stockOf(store.rice.id)).toBe("8");
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).reversedAt).toBeNull();
  });

  it("PIX não mexe em nenhuma gaveta", async () => {
    const sale = await sell({ paymentMethod: PaymentMethod.PIX, amountPaid: undefined });
    await manager();

    expect(await reverse(sale.id)).toMatchObject({
      success: true,
      data: { cashRefund: 0, cashRefundFrom: null },
    });
    expect(await prisma.cashMovement.count()).toBe(0);
    expect(await expectedCash(store.cashRegister.id)).toBe("100");
    expect(
      (await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).reversedInRegister,
    ).toBe(false);
  });

  it("Fiado sem recebimentos: cancela o título e ele deixa de contar como dívida", async () => {
    const sale = await sellOnAccount();
    const reverser = await manager();
    expect((await getReceivablesSummary()).openCount).toBe(1);

    expect(await reverse(sale.id)).toMatchObject({ success: true });

    const receivable = await prisma.receivable.findUniqueOrThrow({ where: { saleId: sale.id } });
    expect(receivable.status).toBe("CANCELED");
    expect(await getReceivablesSummary()).toMatchObject({ openCount: 0, openTotal: 0 });
    expect(await prisma.cashMovement.count()).toBe(0);

    // Título cancelado não aceita recebimento
    await openCashRegister(reverser.id);
    expect(
      await registerReceivablePayment({ receivableId: receivable.id, amount: 5, method: "PIX" }),
    ).toMatchObject({ success: false });
  });

  it("Fiado com recebimentos: devolve o dinheiro recebido em sangria", async () => {
    const sale = await sellOnAccount();
    loginAs(store.user.id, "SELLER");
    const receivable = await prisma.receivable.findUniqueOrThrow({ where: { saleId: sale.id } });
    expect(
      await registerReceivablePayment({ receivableId: receivable.id, amount: 20, method: "MONEY" }),
    ).toMatchObject({ success: true });
    expect(
      await registerReceivablePayment({ receivableId: receivable.id, amount: 5, method: "PIX" }),
    ).toMatchObject({ success: true });

    const reverser = await manager();
    const own = await openCashRegister(reverser.id);

    expect(await reverse(sale.id)).toMatchObject({
      success: true,
      data: { cashRefund: 20, cashRefundFrom: "OWN_REGISTER" },
    });
    expect(await expectedCash(own.id)).toBe("80");
    const saved = await prisma.receivable.findUniqueOrThrow({ where: { id: receivable.id } });
    expect(saved.status).toBe("CANCELED");
  });

  it("não estorna duas vezes", async () => {
    const sale = await sell();
    await manager();

    expect(await reverse(sale.id)).toMatchObject({ success: true });
    expect(await reverse(sale.id)).toEqual({
      success: false,
      error: "Esta venda já foi estornada.",
    });
    expect(await stockOf(store.rice.id)).toBe("10");
    expect(await prisma.stockMovement.count({ where: { type: MovementType.IN } })).toBe(2);
  });

  it("estornos concorrentes da mesma venda aplicam um só", async () => {
    const sale = await sell();
    await manager();

    const results = await Promise.all([reverse(sale.id), reverse(sale.id)]);

    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(await stockOf(store.rice.id)).toBe("10");
  });

  it("vendedor não vê o botão de estorno", async () => {
    const sale = await sell();
    loginAs(store.user.id, "SELLER");
    expect((await getSaleDetail(sale.id))?.canReverse).toBe(false);

    loginAs(store.user.id, "MANAGER");
    expect((await getSaleDetail(sale.id))?.canReverse).toBe(true);
  });
});
