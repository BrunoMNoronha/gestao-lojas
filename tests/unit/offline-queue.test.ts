import { randomUUID } from "node:crypto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  endOfflineSession,
  OfflineUserDb,
  readMeta,
  unsentSalesForCashRegister,
  userDb,
  type LocalOperation,
} from "@/lib/offline/db";
import { pendingByGrant, recordSale, sendQueue } from "@/lib/offline/queue";
import {
  buildSaleOperation,
  newLocalOperation,
  SaleDraftError,
  type PdvSaleDraft,
} from "@/lib/offline/sale-operation";

// Fila de vendas do /pdv (issue #38, docs/OFFLINE.md seções 4 e 5) com o IndexedDB simulado
// (fake-indexeddb) e o servidor simulado por um fetch falso. Cada teste usa um operador novo, ou
// seja, um banco local próprio.

const HOUR = 60 * 60 * 1000;
let userId: string;
let cashRegisterId: string;

async function prepare({ expiresInMs = 12 * HOUR } = {}) {
  const db = userDb(userId);
  const grant = {
    id: randomUUID(),
    deviceId: randomUUID(),
    cashRegisterId,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  };
  await db.meta.bulkPut([
    { key: "grant", value: grant },
    { key: "user", value: { id: userId, name: "Operador", role: "SELLER" } },
    {
      key: "sync",
      value: {
        cursor: "c",
        complete: true,
        syncedAt: Date.now(),
        generatedAt: null,
        watermark: "1",
      },
    },
    {
      key: "cashRegister",
      value: { id: cashRegisterId, openedAt: new Date().toISOString(), openingAmount: "100.00" },
    },
  ]);
  return grant;
}

const draft = (overrides: Partial<PdvSaleDraft> = {}): PdvSaleDraft => ({
  operationId: randomUUID(),
  customer: null,
  paymentMethod: "PIX",
  discount: 0,
  items: [{ productId: "p1", name: "Arroz", unit: "UN", quantity: 1, unitPrice: 10 }],
  ...overrides,
});

type Result = Record<string, unknown> & { operationId: string; status: string };

/** Servidor falso: responde cada operação do lote com a função dada e guarda os lotes. */
function server(respond: (op: { operationId: string }, index: number) => Result) {
  const batches: { operationId: string }[][] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { operations: { operationId: string }[] };
    batches.push(body.operations);
    return Response.json({ protocolVersion: 1, results: body.operations.map(respond) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { batches, fetchMock };
}

const applied = (op: { operationId: string }, index = 0): Result => ({
  operationId: op.operationId,
  status: "applied",
  replayed: false,
  sale: { id: `sale-${index}`, code: 100 + index, occurredAt: new Date().toISOString() },
  appliedTxid: String(1000 + index),
});

const get = (id: string) => userDb(userId).operations.get(id) as Promise<LocalOperation>;

beforeEach(async () => {
  userId = `user-${randomUUID()}`;
  cashRegisterId = `cash-${randomUUID()}`;
  await prepare();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recordSale", () => {
  it("grava a venda pendente com a autorização e bloqueia o fechamento do caixa", async () => {
    const op = await recordSale(userId, draft());
    const stored = await get(op.id);
    expect(stored.status).toBe("pending");
    expect(stored.request.cashRegisterId).toBe(cashRegisterId);
    expect(stored.request.userId).toBe(userId);
    expect(await unsentSalesForCashRegister(cashRegisterId)).toBe(1);
    expect(await unsentSalesForCashRegister("outro-caixa")).toBe(0);
  });

  it("não grava com a autorização vencida", async () => {
    await prepare({ expiresInMs: -1 });
    await expect(recordSale(userId, draft())).rejects.toThrow(SaleDraftError);
    expect(await userDb(userId).operations.count()).toBe(0);
  });

  it("a mesma chave nunca sobrescreve uma venda já gravada", async () => {
    const first = draft();
    await recordSale(userId, first);
    await expect(recordSale(userId, { ...first, discount: 1 })).rejects.toThrow(/chave/);
    expect((await get(first.operationId)).request.payload.discount).toBe("0.00");
  });

  it("nova tentativa da mesma venda devolve a já gravada, mesmo com a autorização vencida", async () => {
    const first = draft();
    const op = await recordSale(userId, first);
    await prepare({ expiresInMs: -1 });
    expect(await recordSale(userId, { ...first })).toEqual(op);
    expect(await userDb(userId).operations.count()).toBe(1);
  });
});

describe("sendQueue", () => {
  it("envia, guarda o código oficial e libera o fechamento", async () => {
    const op = await recordSale(userId, draft());
    const { batches } = server(applied);

    expect(await sendQueue(userId)).toEqual({ status: "done", applied: 1 });
    expect(batches).toHaveLength(1);
    const stored = await get(op.id);
    expect(stored).toMatchObject({
      status: "synced",
      sale: { id: "sale-0", code: 100 },
      appliedTxid: "1000",
      attempts: 1,
      message: null,
    });
    expect(stored.settledAt).not.toBeNull();
    expect(await unsentSalesForCashRegister(cashRegisterId)).toBe(0);

    // Nada mais a enviar: nenhuma requisição nova
    expect(await sendQueue(userId)).toEqual({ status: "done", applied: 0 });
    expect(batches).toHaveLength(1);
  });

  it("sem rede: falha recuperável, nada perdido, e a próxima rodada envia", async () => {
    const op = await recordSale(userId, draft());
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    expect((await sendQueue(userId)).status).toBe("unreachable");
    expect(await get(op.id)).toMatchObject({ status: "failed", attempts: 1 });
    expect(await unsentSalesForCashRegister(cashRegisterId)).toBe(1);

    server(applied);
    expect(await sendQueue(userId)).toEqual({ status: "done", applied: 1 });
    expect(await get(op.id)).toMatchObject({ status: "synced", attempts: 2 });
  });

  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [503, "unreachable"],
  ])("resposta %i: a venda continua guardada para reenvio", async (status, expected) => {
    const op = await recordSale(userId, draft());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({}, { status })));
    expect((await sendQueue(userId)).status).toBe(expected);
    expect((await get(op.id)).status).toBe("failed");
  });

  it("protocolo desconhecido pelo servidor pede atualização do app", async () => {
    const op = await recordSale(userId, draft());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ code: "protocol" }, { status: 400 })),
    );
    expect((await sendQueue(userId)).status).toBe("outdated");
    expect((await get(op.id)).status).toBe("failed");
  });

  it("separa conflito e recusa (regra de negócio) de falha temporária", async () => {
    const ops = [];
    for (let i = 0; i < 6; i++) ops.push(await recordSale(userId, draft()));
    const statuses = ["conflict", "invalid", "protocol_error", "retry", "forbidden"];
    server((op, index) =>
      index === 5
        ? { operationId: "outra", status: "retry" } // sem resultado para esta operação
        : {
            operationId: op.operationId,
            status: statuses[index],
            replayed: false,
            reason: "PRICE_NOT_VALID",
            message: `mensagem ${index}`,
          },
    );

    expect(await sendQueue(userId)).toEqual({ status: "done", applied: 0 });
    const stored = await Promise.all(ops.map((op) => get(op.id)));
    expect(stored.map((op) => op.status)).toEqual([
      "conflict",
      "rejected",
      "rejected",
      "failed",
      "failed",
      "failed",
    ]);
    expect(stored[0]).toMatchObject({ conflictReason: "PRICE_NOT_VALID", message: "mensagem 0" });
    // Conflito já está no servidor; recusada e falhas, não
    expect(await unsentSalesForCashRegister(cashRegisterId)).toBe(5);
  });

  it("consulta o conflito de novo só depois de 5 min ou no envio manual", async () => {
    const op = await recordSale(userId, draft());
    const conflict = (o: { operationId: string }): Result => ({
      operationId: o.operationId,
      status: "conflict",
      replayed: false,
      reason: "PRICE_NOT_VALID",
      message: "Preço",
    });
    const first = server(conflict);
    await sendQueue(userId);
    expect(first.batches).toHaveLength(1);

    const second = server(conflict);
    await sendQueue(userId);
    expect(second.batches).toHaveLength(0);

    // Botão manual: o gerente aprovou
    const third = server((o) => ({ ...applied(o), status: "approved", replayed: true }));
    expect(await sendQueue(userId, { includeConflicts: true })).toEqual({
      status: "done",
      applied: 1,
    });
    expect(third.batches).toHaveLength(1);
    expect(await get(op.id)).toMatchObject({ status: "synced", approved: true });
  });

  it("descarte do gerente finaliza a venda e para de reservar", async () => {
    const op = await recordSale(userId, draft());
    server((o) => ({
      operationId: o.operationId,
      status: "discarded",
      replayed: true,
      message: "Duplicada",
    }));
    await sendQueue(userId);
    expect(await get(op.id)).toMatchObject({ status: "discarded", message: "Duplicada" });
  });

  it("envia em lotes de até 50, na ordem em que as vendas aconteceram", async () => {
    const ids: string[] = [];
    const db = userDb(userId);
    for (let i = 0; i < 120; i++) {
      const op = await recordSale(userId, draft());
      // Ordem de criação invertida em relação à gravação
      await db.operations.update(op.id, { createdAt: 10_000 - i });
      ids.unshift(op.id);
    }
    const { batches } = server(applied);

    expect(await sendQueue(userId)).toEqual({ status: "done", applied: 120 });
    expect(batches.map((b) => b.length)).toEqual([50, 50, 20]);
    expect(batches.flat().map((op) => op.operationId)).toEqual(ids);
  });

  it("vendas no mesmo milissegundo saem na ordem em que foram gravadas", async () => {
    // Só o Date é congelado: os temporizadores do fake-indexeddb seguem reais
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-04T12:00:00.000Z") });
    const ids: string[] = [];
    try {
      for (let i = 0; i < 20; i++) ids.push((await recordSale(userId, draft())).id);
    } finally {
      vi.useRealTimers();
    }
    const stored = await Promise.all(ids.map(get));
    expect(new Set(stored.map((op) => op.createdAt)).size).toBe(1);

    const { batches } = server(applied);
    await sendQueue(userId);
    expect(batches.flat().map((op) => op.operationId)).toEqual(ids);
    expect(stored.map((op) => op.seq)).toEqual(ids.map((_, i) => i + 1));
  });

  it("o número de ordem continua depois das vendas já gravadas, mesmo após a limpeza", async () => {
    const db = userDb(userId);
    const first = await recordSale(userId, draft());
    const second = await recordSale(userId, draft());
    await db.operations.delete(first.id);
    expect((await recordSale(userId, draft())).seq).toBe((second.seq ?? 0) + 1);
  });

  it("uma aba por vez: com a trava ocupada por outra aba, não envia", async () => {
    await recordSale(userId, draft());
    const { batches } = server(applied);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const otherTab = navigator.locks.request(`gestao-lojas-offline-send-${userId}`, () => held);

    expect(await sendQueue(userId)).toEqual({ status: "busy", applied: 0 });
    expect(batches).toHaveLength(0);
    release();
    await otherTab;
    expect((await sendQueue(userId)).applied).toBe(1);
  });

  it("retoma a venda que ficou 'sincronizando' numa aba fechada no meio do envio", async () => {
    const op = await recordSale(userId, draft());
    await userDb(userId).operations.update(op.id, { status: "syncing" });
    server(applied);
    expect((await sendQueue(userId)).applied).toBe(1);
  });
});

describe("endOfflineSession", () => {
  it("apaga a cópia e a autorização, mas mantém as vendas não enviadas", async () => {
    const db = userDb(userId);
    const op = await recordSale(userId, draft());
    await db.products.put({
      id: "p1",
      deleted: false,
      name: "Arroz",
      sku: null,
      barcode: null,
      salePrice: "10.00",
      unit: "UN",
      currentStock: "5.000",
      categoryId: null,
      updatedAt: new Date().toISOString(),
    });

    await endOfflineSession(userId);
    expect(await db.products.count()).toBe(0);
    expect(await readMeta(db, "grant")).toBeUndefined();
    expect((await get(op.id)).status).toBe("pending");
    expect(await unsentSalesForCashRegister(cashRegisterId)).toBe(1);
  });

  it("sem nada pendente, remove o banco do operador", async () => {
    await recordSale(userId, draft());
    server(applied);
    await sendQueue(userId);
    await endOfflineSession(userId);
    expect(await Dexie.exists(`gestao-lojas-offline-${userId}`)).toBe(false);
  });
});

describe("atualização da estrutura (versão 1 → 2)", () => {
  it("preserva a fila existente", async () => {
    const name = `gestao-lojas-offline-${userId}`;
    userDb(userId).close();
    await Dexie.delete(name);

    // Banco criado pela versão anterior do app (#37), com uma linha antiga e uma venda
    const v1 = new Dexie(name);
    v1.version(1).stores({
      products: "id, barcode, sku, categoryId",
      categories: "id",
      customers: "id",
      meta: "key",
      operations: "id, status, createdAt",
    });
    const full = newLocalOperation(
      buildSaleOperation(draft(), {
        userId,
        userName: "Operador",
        deviceId: randomUUID(),
        grantId: randomUUID(),
        cashRegisterId,
        now: new Date(),
      }),
      Date.now(),
    );
    // Sem os campos que só existem na versão 2
    const withoutNewFields: Partial<LocalOperation> = { ...full };
    delete withoutNewFields.attempts;
    delete withoutNewFields.settledAt;
    delete withoutNewFields.approved;
    await v1
      .table("operations")
      .bulkAdd([{ id: "antiga", status: "pending", createdAt: 1 }, withoutNewFields]);
    v1.close();

    // O app novo abre o mesmo banco na versão 2
    const reopened = new OfflineUserDb(userId);
    const rows = await reopened.operations.toArray();
    expect(reopened.verno).toBe(2);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === "antiga")).toMatchObject({
      status: "rejected",
      attempts: 0,
    });
    expect(rows.find((r) => r.id === full.id)).toMatchObject({
      status: "pending",
      attempts: 0,
      approved: false,
      settledAt: null,
      request: full.request,
    });
    reopened.close();
  });
});

describe("pendingByGrant (informe ao servidor)", () => {
  it("conta só as vendas não gravadas, por autorização, e zera a atual sem vendas", async () => {
    const a = await recordSale(userId, draft());
    const b = await recordSale(userId, draft());
    const c = await recordSale(userId, draft());
    const db = userDb(userId);
    await db.operations.update(b.id, { status: "conflict" });
    await db.operations.update(c.id, { status: "synced" });
    const old = { ...a, id: "velha", status: "rejected" as const };
    old.request = { ...a.request, grantId: "autorizacao-antiga" };
    const ops = [...(await db.operations.toArray()), old];

    expect(pendingByGrant(ops, a.request.grantId)).toEqual([
      { grantId: a.request.grantId, pending: 1 },
      { grantId: "autorizacao-antiga", pending: 1 },
    ]);
    expect(pendingByGrant([], "atual")).toEqual([{ grantId: "atual", pending: 0 }]);
  });

  it("envio da fila do operador informa o servidor; envio assistido, não", async () => {
    await recordSale(userId, draft());
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(url);
        if (url.endsWith("/report")) return Response.json({ updated: 1 });
        const body = JSON.parse(String(init.body)) as { operations: { operationId: string }[] };
        return Response.json({ protocolVersion: 1, results: body.operations.map(applied) });
      }),
    );
    // O banco comum precisa do aparelho para o informe
    const { savePreparation } = await import("@/lib/offline/db");
    const grant = await readMeta(userDb(userId), "grant");
    await savePreparation(
      {
        device: { id: grant!.deviceId, name: "Teste" },
        grant: { ...grant! },
        user: { id: userId, name: "Operador", role: "SELLER" },
      },
      true,
    );

    await sendQueue(userId, { report: true });
    expect(calls).toEqual(["/api/offline/operations", "/api/offline/report"]);
    calls.length = 0;
    await recordSale(userId, draft());
    await sendQueue(userId);
    expect(calls).toEqual(["/api/offline/operations"]);
  });
});
