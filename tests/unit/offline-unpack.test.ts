import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readMeta, userDb } from "@/lib/offline/db";
import { recordSale } from "@/lib/offline/queue";
import { confirmLocalUnpack, prepareLocalUnpack, refreshLocalUnpack } from "@/lib/offline/unpack";
import type { UnpackInput, UnpackResult } from "@/lib/unpack";

const mocks = vi.hoisted(() => ({
  connectivity: vi.fn(),
  send: vi.fn(),
  snapshot: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@/actions/unpack", () => ({ openPdvBoxes: mocks.open }));
vi.mock("@/lib/offline/sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/sync")>()),
  checkConnectivity: mocks.connectivity,
  syncSnapshot: mocks.snapshot,
}));
vi.mock("@/lib/offline/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/queue")>()),
  sendQueue: mocks.send,
}));

let userId: string;
let input: UnpackInput;
let success: Extract<UnpackResult, { success: true }>;
beforeEach(async () => {
  vi.clearAllMocks();
  userId = randomUUID();
  input = {
    operationId: randomUUID(),
    boxProductId: "box",
    expectedUnitProductId: "unit",
    expectedUnitsPerBox: 12,
    boxQuantity: 1,
    reservedBoxes: 0,
  };
  success = {
    success: true,
    data: {
      conversionId: "conversion",
      boxProductId: "box",
      unitProductId: "unit",
      boxQuantity: 1,
      unitQuantity: 12,
      replayed: false,
      appliedTxid: "50",
    },
  };
  vi.stubGlobal("navigator", { locks: { request: vi.fn((_name, callback) => callback()) } });
  mocks.connectivity.mockResolvedValue({ status: "online", user: { id: userId } });
  mocks.send.mockResolvedValue({ status: "done", applied: 0 });
  mocks.open.mockResolvedValue(success);
  const db = userDb(userId);
  await db.products.bulkPut([
    {
      id: "box",
      deleted: false,
      name: "Caixa",
      unit: "CX",
      currentStock: "3.000",
      containedProductId: "unit",
      unitsPerBox: 12,
      salePrice: "56.00",
      sku: null,
      barcode: null,
      categoryId: null,
      updatedAt: new Date().toISOString(),
    },
    {
      id: "unit",
      deleted: false,
      name: "Lata",
      unit: "UN",
      currentStock: "0.000",
      salePrice: "8.00",
      sku: null,
      barcode: null,
      categoryId: null,
      updatedAt: new Date().toISOString(),
    },
  ]);
  await db.meta.bulkPut([
    {
      key: "grant",
      value: {
        id: randomUUID(),
        deviceId: randomUUID(),
        cashRegisterId: "cash",
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    },
    {
      key: "cashRegister",
      value: { id: "cash", openedAt: new Date().toISOString(), openingAmount: "0" },
    },
    {
      key: "sync",
      value: {
        cursor: "c",
        complete: true,
        syncedAt: Date.now(),
        generatedAt: null,
        watermark: "100",
      },
    },
  ]);
  mocks.snapshot.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe("abertura online no PDV local", () => {
  it("confere rede real e fila antes de sugerir; com conexão ausente não abre caixa", async () => {
    expect(await prepareLocalUnpack(userId)).toHaveLength(2);
    expect(mocks.send).toHaveBeenCalledWith(userId, { includeConflicts: true, report: true });
    mocks.connectivity.mockResolvedValue({ status: "unreachable" });
    await expect(prepareLocalUnpack(userId)).rejects.toThrow(/conexão/);
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("bloqueia abertura se a fila ainda tem pendência, conflito ou recusa", async () => {
    const db = userDb(userId);
    for (const status of ["pending", "conflict", "rejected"] as const) {
      await db.operations.put({ id: "old", status } as never);
      await expect(prepareLocalUnpack(userId)).rejects.toThrow(/fila/);
    }
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("guarda a operação antes da chamada e libera vendas só após snapshot refletido", async () => {
    mocks.open.mockImplementation(async () => {
      expect((await readMeta(userDb(userId), "unpackPending"))?.input).toEqual(input);
      return success;
    });
    expect(await confirmLocalUnpack(userId, input)).toEqual(success);
    expect((await readMeta(userDb(userId), "unpackPending"))?.data?.conversionId).toBe(
      "conversion",
    );
    await expect(
      recordSale(userId, {
        operationId: randomUUID(),
        customer: null,
        paymentMethod: "PIX",
        discount: 0,
        items: [{ productId: "unit", name: "Lata", unit: "UN", quantity: 1, unitPrice: 8 }],
      }),
    ).rejects.toThrow(/abertura.*pendente/);
    await refreshLocalUnpack(userId, success.data);
    expect(await readMeta(userDb(userId), "unpackPending")).toBeNull();
  });
  it("preserva a chave com resposta incerta e impede outra abertura", async () => {
    mocks.open.mockResolvedValue({ success: false, uncertain: true, error: "Falha técnica" });
    await confirmLocalUnpack(userId, input);
    expect((await readMeta(userDb(userId), "unpackPending"))?.operationId).toBe(input.operationId);
    expect(await confirmLocalUnpack(userId, { ...input, operationId: randomUUID() })).toMatchObject(
      { success: false },
    );
    expect(mocks.open).toHaveBeenCalledTimes(1);
  });
  it("verifica a mesma chave incerta mesmo se o turno original fechou", async () => {
    mocks.open.mockResolvedValueOnce({
      success: false,
      uncertain: true,
      error: "Resposta perdida",
    });
    await confirmLocalUnpack(userId, input);
    await userDb(userId).meta.put({ key: "cashRegister", value: null });
    expect(await confirmLocalUnpack(userId, input)).toEqual(success);
    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(mocks.open.mock.calls[1][0].operationId).toBe(input.operationId);
  });
  it("snapshot atrasado ou falho conserva bloqueio e repetir refresh não abre outra caixa", async () => {
    await confirmLocalUnpack(userId, input);
    const db = userDb(userId);
    const sync = (await readMeta(db, "sync"))!;
    await db.meta.put({ key: "sync", value: { ...sync, watermark: "50" } });
    await expect(refreshLocalUnpack(userId, success.data)).rejects.toThrow(/saldos.*cópia/);
    expect(await readMeta(db, "unpackPending")).not.toBeNull();
    await db.meta.put({ key: "sync", value: { ...sync, watermark: "51" } });
    mocks.snapshot.mockRejectedValueOnce(new Error("rede caiu"));
    await expect(refreshLocalUnpack(userId, success.data)).rejects.toThrow(/rede/);
    expect(await readMeta(db, "unpackPending")).not.toBeNull();
    await refreshLocalUnpack(userId, success.data);
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(await readMeta(db, "unpackPending")).toBeNull();
  });
  it("recusa conversão sem Web Locks, mantendo a operação fora da fila offline", async () => {
    vi.stubGlobal("navigator", {});
    await expect(prepareLocalUnpack(userId)).rejects.toThrow(/navegador/);
    expect(await userDb(userId).operations.count()).toBe(0);
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
