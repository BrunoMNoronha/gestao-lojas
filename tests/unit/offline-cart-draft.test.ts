import { randomUUID } from "node:crypto";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CART_DRAFT_ID,
  CART_DRAFT_MAX_AGE_MS,
  restoreCartDraft,
  type CartDraft,
  type CartDraftInput,
  type DraftProduct,
} from "@/lib/offline/cart-draft";
import {
  endOfflineSession,
  loadCartDraft,
  OfflineUserDb,
  saveCartDraft,
  userDb,
} from "@/lib/offline/db";
import { recordSale } from "@/lib/offline/queue";
import type { PdvSaleDraft } from "@/lib/offline/sale-operation";

// Rascunho do carrinho do /pdv (issue #53): conferência com a cópia local ao reabrir e gravação
// no banco do operador, com o IndexedDB simulado (fake-indexeddb). A regra central: a venda e a
// remoção do rascunho acontecem juntas, então o carrinho vendido nunca volta.

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-04T15:00:00.000Z");
const PAYMENTS = ["MONEY", "PIX", "CREDIT_CARD", "DEBIT_CARD"] as const;

const rice: DraftProduct = {
  id: "p1",
  name: "Arroz",
  barcode: "789",
  salePrice: 10,
  unit: "UN",
  currentStock: 10,
};
const cheese: DraftProduct = {
  id: "p2",
  name: "Queijo",
  barcode: null,
  salePrice: 45.9,
  unit: "KG",
  currentStock: 5,
};
const customer = { id: "c1", name: "Maria", document: "***.456.789-**" };

function savedDraft(overrides: Partial<CartDraft> = {}): CartDraft {
  return {
    id: CART_DRAFT_ID,
    updatedAt: NOW - HOUR,
    items: [
      { productId: "p1", name: "Arroz", unit: "UN", barcode: "789", quantity: 2, unitPrice: 10 },
      {
        productId: "p2",
        name: "Queijo",
        unit: "KG",
        barcode: null,
        quantity: 0.5,
        unitPrice: 45.9,
      },
    ],
    customer,
    discount: 1.5,
    checkout: { paymentMethod: "MONEY", amountPaid: 50 },
    operation: { id: "op-1", signature: "sig" },
    ...overrides,
  };
}

const restore = (draft: CartDraft | null, products = [rice, cheese], customers = [customer]) =>
  restoreCartDraft(draft, {
    products,
    customers,
    paymentMethods: [...PAYMENTS],
    now: NOW,
  });

describe("restoreCartDraft", () => {
  it("sem mudanças: devolve itens, cliente, desconto, pagamento e a chave da venda", () => {
    const { cart, notices } = restore(savedDraft());
    expect(notices).toEqual([]);
    expect(cart).toEqual({
      items: [
        expect.objectContaining({ productId: "p1", quantity: 2, subtotal: 20, maxStock: 10 }),
        // 0,5 x 45,90 = 22,95
        expect.objectContaining({ productId: "p2", quantity: 0.5, subtotal: 22.95, maxStock: 5 }),
      ],
      customer,
      discount: 1.5,
      checkout: { paymentMethod: "MONEY", amountPaid: 50 },
      operation: { id: "op-1", signature: "sig" },
    });
  });

  it("nada guardado: carrinho vazio, sem aviso", () => {
    expect(restore(null)).toEqual({ cart: null, notices: [] });
  });

  it("descarta o rascunho com mais de 12 h, com aviso", () => {
    const { cart, notices } = restore(savedDraft({ updatedAt: NOW - CART_DRAFT_MAX_AGE_MS - 1 }));
    expect(cart).toBeNull();
    expect(notices).toEqual([expect.stringContaining("mais de 12 horas")]);
  });

  it("produto excluído sai do carrinho, com aviso, e a chave da venda é descartada", () => {
    const { cart, notices } = restore(savedDraft(), [cheese]);
    expect(cart?.items.map((i) => i.productId)).toEqual(["p2"]);
    expect(notices).toEqual([expect.stringContaining('"Arroz" saiu do carrinho')]);
    expect(cart?.operation).toBeNull();
    // Com mudanças, o operador confere o carrinho antes de pagar
    expect(cart?.checkout).toBeNull();
  });

  it("preço mudou: vale o preço atual da cópia, com aviso", () => {
    const { cart, notices } = restore(savedDraft(), [{ ...rice, salePrice: 12.5 }, cheese]);
    expect(cart?.items[0]).toMatchObject({ unitPrice: 12.5, subtotal: 25 });
    expect(notices).toEqual([
      expect.stringMatching(/preço de "Arroz" mudou de R\$\s10,00 para R\$\s12,50/),
    ]);
  });

  it("quantidade fracionada em produto por unidade é ajustada ou removida", () => {
    const fractional = savedDraft({
      items: [
        { productId: "p1", name: "Arroz", unit: "KG", barcode: null, quantity: 2.5, unitPrice: 10 },
        { productId: "p3", name: "Caixa", unit: "KG", barcode: null, quantity: 0.4, unitPrice: 3 },
      ],
    });
    const box = { ...rice, id: "p3", name: "Caixa", salePrice: 3, unit: "CX" };
    const { cart, notices } = restore(fractional, [rice, box]);
    expect(cart?.items).toEqual([expect.objectContaining({ productId: "p1", quantity: 2 })]);
    expect(notices).toEqual([
      expect.stringContaining('quantidade de "Arroz" foi ajustada para 2 UN'),
      expect.stringContaining('"Caixa" saiu do carrinho'),
    ]);
  });

  it("quantidade acima do saldo disponível é ajustada; sem saldo, o item sai", () => {
    const { cart, notices } = restore(savedDraft(), [
      { ...rice, currentStock: 1 },
      { ...cheese, currentStock: 0 },
    ]);
    expect(cart?.items).toEqual([expect.objectContaining({ productId: "p1", quantity: 1 })]);
    expect(notices).toEqual([
      expect.stringContaining('quantidade de "Arroz" foi ajustada para 1 UN'),
      expect.stringContaining('"Queijo" saiu do carrinho: sem saldo'),
    ]);
  });

  it("cliente que não está mais na cópia sai da venda, com aviso", () => {
    const { cart, notices } = restore(savedDraft(), [rice, cheese], []);
    expect(cart?.customer).toBeNull();
    expect(cart?.items).toHaveLength(2);
    expect(notices).toEqual([expect.stringContaining('cliente "Maria"')]);
  });

  it("sem nenhum item nem cliente restante, não restaura nada (mas avisa)", () => {
    const { cart, notices } = restore(savedDraft({ customer: null }), []);
    expect(cart).toBeNull();
    expect(notices).toHaveLength(2);
  });

  it("forma de pagamento indisponível no /pdv não reabre o pagamento", () => {
    const { cart } = restore(
      savedDraft({ checkout: { paymentMethod: "ON_ACCOUNT", amountPaid: 0 } }),
    );
    expect(cart?.checkout).toBeNull();
    expect(cart?.items).toHaveLength(2);
  });
});

// Banco do operador: cada teste usa um operador novo, ou seja, um banco local próprio

let userId: string;
let cashRegisterId: string;

async function prepare() {
  const db = userDb(userId);
  await db.meta.bulkPut([
    {
      key: "grant",
      value: {
        id: randomUUID(),
        deviceId: randomUUID(),
        cashRegisterId,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 12 * HOUR).toISOString(),
      },
    },
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
}

const input = (operationId: string | null = null): CartDraftInput => ({
  items: [
    { productId: "p1", name: "Arroz", unit: "UN", barcode: null, quantity: 1, unitPrice: 10 },
  ],
  customer: null,
  discount: 0,
  checkout: null,
  operation: operationId ? { id: operationId, signature: "sig" } : null,
});

const sale = (operationId: string): PdvSaleDraft => ({
  operationId,
  customer: null,
  paymentMethod: "PIX",
  discount: 0,
  items: [{ productId: "p1", name: "Arroz", unit: "UN", quantity: 1, unitPrice: 10 }],
});

beforeEach(async () => {
  userId = `user-${randomUUID()}`;
  cashRegisterId = `cash-${randomUUID()}`;
  await prepare();
  await userDb(userId).products.put({
    id: "p1",
    deleted: false,
    name: "Arroz",
    unit: "UN",
    currentStock: "1000.000",
    salePrice: "10.00",
    sku: null,
    barcode: null,
    categoryId: null,
    updatedAt: new Date().toISOString(),
  });
});

describe("rascunho no banco do operador", () => {
  it("grava, lê de volta com a hora da gravação e apaga com null", async () => {
    await saveCartDraft(userId, input());
    const stored = await loadCartDraft(userId);
    expect(stored).toMatchObject({ ...input(), id: CART_DRAFT_ID });
    expect(Date.now() - stored!.updatedAt).toBeLessThan(5_000);

    await saveCartDraft(userId, null);
    expect(await loadCartDraft(userId)).toBeNull();
  });

  it("fica no banco do operador: outro usuário não vê", async () => {
    await saveCartDraft(userId, input());
    expect(await loadCartDraft(`outro-${randomUUID()}`)).toBeNull();
  });

  it("a venda apaga o rascunho na mesma gravação", async () => {
    const id = randomUUID();
    await saveCartDraft(userId, input(id));
    await recordSale(userId, sale(id));
    expect(await userDb(userId).drafts.get(CART_DRAFT_ID)).toBeUndefined();
    expect(await userDb(userId).operations.count()).toBe(1);
  });

  it("falha ao gravar a venda (ex.: sem espaço) mantém o rascunho com a mesma chave", async () => {
    const id = randomUUID();
    await saveCartDraft(userId, input(id));
    const db = userDb(userId);
    const failing = () => {
      throw new DOMException("cota", "QuotaExceededError");
    };
    db.operations.hook("creating", failing);
    try {
      await expect(recordSale(userId, sale(id))).rejects.toThrow();
    } finally {
      db.operations.hook("creating").unsubscribe(failing);
    }
    expect(await db.operations.count()).toBe(0);
    expect((await loadCartDraft(userId))?.operation?.id).toBe(id);

    // A nova tentativa com a mesma chave grava uma única venda e apaga o rascunho
    await recordSale(userId, sale(id));
    expect(await db.operations.count()).toBe(1);
    expect(await loadCartDraft(userId)).toBeNull();
  });

  it("gravação atrasada do carrinho já vendido não faz ele voltar", async () => {
    const id = randomUUID();
    await recordSale(userId, sale(id));
    await saveCartDraft(userId, input(id));
    expect(await userDb(userId).drafts.get(CART_DRAFT_ID)).toBeUndefined();

    // Mesmo gravado direto (versão antiga, outra aba), a leitura descarta e apaga
    await userDb(userId).drafts.put({ ...input(id), id: CART_DRAFT_ID, updatedAt: Date.now() });
    expect(await loadCartDraft(userId)).toBeNull();
    expect(await userDb(userId).drafts.count()).toBe(0);
  });

  it("nova tentativa de venda já gravada também apaga o rascunho", async () => {
    const id = randomUUID();
    await recordSale(userId, sale(id));
    await userDb(userId).drafts.put({ ...input(), id: CART_DRAFT_ID, updatedAt: Date.now() });
    await recordSale(userId, sale(id));
    expect(await userDb(userId).drafts.count()).toBe(0);
    expect(await userDb(userId).operations.count()).toBe(1);
  });

  it("saída do operador apaga o rascunho e mantém a fila pendente", async () => {
    await recordSale(userId, sale(randomUUID()));
    await saveCartDraft(userId, input());
    await endOfflineSession(userId);
    expect(await userDb(userId).drafts.count()).toBe(0);
    expect(await userDb(userId).operations.count()).toBe(1);
  });

  it("saída do operador sem fila remove o banco inteiro, com o rascunho", async () => {
    await saveCartDraft(userId, input());
    await endOfflineSession(userId);
    expect(await Dexie.exists(`gestao-lojas-offline-${userId}`)).toBe(false);
  });
});

describe("atualização da estrutura (versão 2 → 4)", () => {
  it("cria a tabela do rascunho sem tocar na fila", async () => {
    const id = randomUUID();
    await recordSale(userId, sale(id));
    const before = await userDb(userId).operations.toArray();
    const name = `gestao-lojas-offline-${userId}`;
    userDb(userId).close();

    // Banco da versão anterior do app (#38), só com as tabelas da versão 2
    const v2 = new Dexie(name);
    v2.version(1).stores({
      products: "id, barcode, sku, categoryId",
      categories: "id",
      customers: "id",
      meta: "key",
      operations: "id, status, createdAt",
    });
    v2.version(2).stores({ operations: "id, status, createdAt, settledAt" });
    await Dexie.delete(name);
    await v2.open();
    await v2.table("operations").bulkAdd(before);
    v2.close();

    const reopened = new OfflineUserDb(userId);
    expect(await reopened.operations.toArray()).toEqual(before);
    expect(reopened.verno).toBe(4);
    expect(await reopened.drafts.count()).toBe(0);
    await reopened.drafts.put({ ...input(), id: CART_DRAFT_ID, updatedAt: Date.now() });
    expect(await reopened.drafts.count()).toBe(1);
    reopened.close();
  });
});
