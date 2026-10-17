import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentMethod, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { registerSale } from "@/lib/create-sale";
import { approveConflict, syncOfflineOperation } from "@/lib/offline-sale";
import {
  createUser,
  offlineSale,
  prepareOffline,
  resetDatabase,
  saleInput,
  seedStore,
  type OfflineContext,
  type Store,
} from "./fixtures";

// Server Action getSaleDetail: autoriza com "cash.own"; quem tem reports.view vê qualquer venda,
// os demais só as próprias. A sessão do Auth.js é simulada.
const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("@/lib/authz", () => ({ authorize }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

const { getSaleDetail } = await import("@/actions/sales");

let store: Store;

const loginAs = (id: string, role: "ADMIN" | "MANAGER" | "SELLER") =>
  authorize.mockResolvedValue({ ok: true, user: { id, name: "Sessão", role } });

async function sell(overrides: Parameters<typeof saleInput>[1] = {}) {
  const result = await registerSale(store.user.id, saleInput(store, overrides));
  if (!result.success) throw new Error(result.error);
  return result.data;
}

beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
  authorize.mockReset();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getSaleDetail (Server Action)", () => {
  it("sem permissão devolve null", async () => {
    const sale = await sell();
    authorize.mockResolvedValue({ ok: false, error: "Sem permissão." });

    expect(await getSaleDetail(sale.id)).toBeNull();
    expect(authorize).toHaveBeenCalledWith("cash.own");
  });

  it("gerente vê a venda de outro operador, com itens, totais e caixa", async () => {
    const sale = await sell({ discount: 2.95 });
    const manager = await createUser("Gerente");
    loginAs(manager.id, "MANAGER");

    const detail = await getSaleDetail(sale.id);

    expect(detail).toMatchObject({
      id: sale.id,
      code: sale.code,
      total: 40,
      discount: 2.95,
      paymentMethod: "MONEY",
      userName: store.user.name,
      customerName: "Consumidor Final",
      amountPaid: null,
      change: null,
      receivable: null,
      offline: null,
      issues: [],
      cashRegister: { userName: store.user.name, closedAt: null },
    });
    expect(detail?.items).toEqual([
      expect.objectContaining({
        productName: "Arroz 5kg",
        quantity: 2,
        unitPrice: 10,
        subtotal: 20,
        productDeleted: false,
      }),
      expect.objectContaining({
        productName: "Queijo minas",
        unit: "KG",
        quantity: 0.5,
        unitPrice: 45.9,
        subtotal: 22.95,
      }),
    ]);
  });

  it("vendedor vê a própria venda e não a de outro operador", async () => {
    const sale = await sell();
    loginAs(store.user.id, "SELLER");
    expect((await getSaleDetail(sale.id))?.id).toBe(sale.id);

    const other = await createUser("Outro vendedor");
    loginAs(other.id, "SELLER");
    expect(await getSaleDetail(sale.id)).toBeNull();
  });

  it("id vazio ou inexistente devolve null", async () => {
    loginAs(store.user.id, "ADMIN");
    expect(await getSaleDetail("")).toBeNull();
    expect(await getSaleDetail("venda-que-nao-existe")).toBeNull();
  });

  it("venda no Fiado traz o título e os pagamentos", async () => {
    const sale = await sell({
      paymentMethod: PaymentMethod.ON_ACCOUNT,
      customerId: store.customer.id,
      amountPaid: undefined,
    });
    const receivable = await prisma.receivable.findUniqueOrThrow({ where: { saleId: sale.id } });
    await prisma.receivablePayment.create({
      data: {
        receivableId: receivable.id,
        amount: new Prisma.Decimal(10),
        method: PaymentMethod.PIX,
        userId: store.user.id,
      },
    });
    await prisma.receivable.update({
      where: { id: receivable.id },
      data: { paidAmount: new Prisma.Decimal(10), status: "PARTIAL" },
    });
    loginAs(store.user.id, "ADMIN");

    const detail = await getSaleDetail(sale.id);

    expect(detail?.customerName).toBe("Cliente Teste");
    expect(detail?.receivable).toMatchObject({
      status: "PARTIAL",
      amount: 42.95,
      paidAmount: 10,
      payments: [expect.objectContaining({ amount: 10, method: "PIX", userName: store.user.name })],
    });
  });

  it("produto excluído depois da venda continua no detalhe, marcado", async () => {
    const sale = await sell();
    await prisma.product.update({ where: { id: store.rice.id }, data: { deletedAt: new Date() } });
    loginAs(store.user.id, "ADMIN");

    const detail = await getSaleDetail(sale.id);

    expect(detail?.items.find((i) => i.productId === store.rice.id)).toMatchObject({
      productName: "Arroz 5kg",
      productDeleted: true,
    });
  });
});

describe("getSaleDetail com venda feita sem internet", () => {
  let ctx: OfflineContext;
  const seller = () => ({ id: store.user.id, name: store.user.name, role: "SELLER" as const });

  beforeEach(async () => {
    const { device, grant } = await prepareOffline(store.user.id, store.cashRegister.id);
    ctx = {
      userId: store.user.id,
      deviceId: device.id,
      grantId: grant.id,
      cashRegisterId: store.cashRegister.id,
    };
  });

  async function applyOffline(payload: Record<string, unknown> = {}) {
    const result = await syncOfflineOperation(seller(), offlineSale(store, ctx, {}, payload));
    if (result.status !== "applied") throw new Error(JSON.stringify(result));
    return result.sale.id;
  }

  it("venda online tem operação de idempotência, mas não aparece como offline", async () => {
    const sale = await sell();
    expect(await prisma.syncOperation.count({ where: { saleId: sale.id } })).toBe(1);
    loginAs(store.user.id, "ADMIN");

    expect((await getSaleDetail(sale.id))?.offline).toBeNull();
  });

  it("venda sincronizada mostra o aparelho, o recebimento e a situação", async () => {
    const saleId = await applyOffline();
    const operation = await prisma.syncOperation.findUniqueOrThrow({ where: { saleId } });
    loginAs(store.user.id, "SELLER");

    const detail = await getSaleDetail(saleId);

    expect(detail?.offline).toEqual({
      deviceName: "Chrome · Windows",
      receivedAt: operation.receivedAt.toISOString(),
      status: "APPLIED",
      submittedByName: null,
    });
    expect(detail?.issues).toEqual([]);
  });

  it("envio assistido aprovado mostra quem enviou", async () => {
    const managerRow = await prisma.user.update({
      where: { id: (await createUser("Gerente")).id },
      data: { role: Role.MANAGER },
    });
    const manager = { id: managerRow.id, name: managerRow.name, role: "MANAGER" as const };
    const op = offlineSale(store, ctx);
    expect(await syncOfflineOperation(manager, op)).toMatchObject({ status: "conflict" });
    expect(await approveConflict(manager, op.operationId, "Conferido")).toMatchObject({
      success: true,
    });
    const { saleId } = await prisma.syncOperation.findUniqueOrThrow({
      where: { id: op.operationId },
    });
    loginAs(manager.id, "MANAGER");

    const detail = await getSaleDetail(saleId!);

    expect(detail?.userName).toBe(store.user.name);
    expect(detail?.offline).toMatchObject({ status: "APPROVED", submittedByName: "Gerente" });
  });

  it("lista as pendências de conciliação e se já foram conferidas", async () => {
    // 12 arroz com 10 em estoque: a venda é aceita e gera pendência de estoque negativo
    const saleId = await applyOffline({
      amountPaid: "120.00",
      items: [{ productId: store.rice.id, quantity: "12", unitPrice: "10.00" }],
    });
    loginAs(store.user.id, "ADMIN");

    const before = await getSaleDetail(saleId);
    expect(before?.issues).toEqual([
      { id: expect.any(String), type: "NEGATIVE_STOCK", acknowledged: false },
    ]);

    await prisma.reconciliationIssue.update({
      where: { id: before!.issues[0].id },
      data: { acknowledgedAt: new Date(), acknowledgedById: store.user.id },
    });

    expect((await getSaleDetail(saleId))?.issues).toEqual([
      { id: before!.issues[0].id, type: "NEGATIVE_STOCK", acknowledged: true },
    ]);
  });
});
