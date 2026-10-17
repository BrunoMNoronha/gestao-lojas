import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { CATALOG_ORDER_CLOSED_ERROR } from "@/lib/catalog-shared";
import { decodeOrderLink, encodeOrderLink } from "@/lib/order-link";
import { effectCounts, resetDatabase, saleInput, seedStore, stockOf, type Store } from "./fixtures";

// Pedidos do catálogo (issue #81): a prévia pública não grava; o link do pedido gera o pedido para
// o usuário logado de forma idempotente; a venda conclui o pedido na mesma transação. A sessão do
// Auth.js e o cache do Next são simulados.
const { authorize, revalidatePath } = vi.hoisted(() => ({
  authorize: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({ authorize }));
vi.mock("next/cache", () => ({
  revalidatePath,
  revalidateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

const { buildCatalogOrder } = await import("@/lib/catalog-order");
const { registerSale } = await import("@/lib/create-sale");
const {
  cancelCatalogOrder,
  getCatalogOrderDetail,
  getCatalogOrderForPdv,
  getCatalogOrderPage,
  registerCatalogOrderFromLink,
} = await import("@/actions/catalog-orders");

let store: Store;

const catalogStore = {
  enabled: true,
  name: "Loja Teste",
  whatsappNumber: "5511999998888",
  phone: null,
  email: null,
  address: null,
  instagram: null,
};

function allow() {
  authorize.mockResolvedValue({
    ok: true,
    user: { id: store.user.id, name: store.user.name, role: "SELLER" },
  });
}

/** Link com 2 arroz + 0,5 kg de queijo (total 42,95) e chave nova. */
const CONTACT = { name: "Maria Souza", phone: "11999998888" };

function orderToken(
  key = randomUUID(),
  items?: { productId: string; quantity: number }[],
  contact = CONTACT,
) {
  return encodeOrderLink({
    key,
    items: items ?? [
      { productId: store.rice.id, quantity: 2 },
      { productId: store.cheese.id, quantity: 0.5 },
    ],
    contact,
  });
}

async function createOrder(token = orderToken()) {
  const result = await registerCatalogOrderFromLink(token);
  if (!result.success) throw new Error(result.error);
  return result;
}

beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
  await prisma.product.updateMany({ data: { showInCatalog: true } });
  authorize.mockReset();
  revalidatePath.mockReset();
  allow();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("prévia pública do pedido", () => {
  it("não grava nada e leva o link criptografado com itens e contato", async () => {
    const result = await buildCatalogOrder(
      {
        items: [{ productId: store.rice.id, quantity: 2 }],
        customer: {
          name: "Maria",
          phone: "(11) 99999-8888",
          fulfillment: "DELIVERY",
          address: "Rua das Flores, 10",
        },
      },
      catalogStore,
      "https://loja.exemplo",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await prisma.catalogOrder.count()).toBe(0);
    const url = /\*Link do pedido:\* (\S+)/.exec(result.message)?.[1] ?? "";
    expect(url).toMatch(/^https:\/\/loja\.exemplo\/catalogo\/pedido\?p=[A-Za-z0-9_-]+$/);
    expect(url).not.toContain("Maria");
    expect(url).not.toContain("99999");
    expect(result.message).toContain("*Telefone:* (11) 99999-8888");
    expect(decodeURIComponent(result.whatsappUrl)).toContain(url);
    expect(decodeOrderLink(new URL(url).searchParams.get("p"))).toMatchObject({
      items: [{ productId: store.rice.id, quantity: 2 }],
      contact: { name: "Maria", phone: "11999998888" },
    });
  });

  it("exige o telefone com DDD", async () => {
    const body = (phone?: string) => ({
      items: [{ productId: store.rice.id, quantity: 2 }],
      customer: { name: "Maria", phone, fulfillment: "PICKUP" },
    });
    for (const phone of [undefined, "", "9999-8888"]) {
      expect(await buildCatalogOrder(body(phone), catalogStore, "https://loja.exemplo")).toEqual({
        ok: false,
        status: 400,
        error: "Informe um telefone com DDD, ex.: (11) 99999-8888.",
      });
    }
  });
});

describe("contato do pedido", () => {
  it("grava nome e telefone e vincula o cliente cadastrado com o mesmo telefone", async () => {
    await prisma.customer.update({
      where: { id: store.customer.id },
      data: { phone: CONTACT.phone },
    });
    const order = await createOrder();
    const saved = await prisma.catalogOrder.findUniqueOrThrow({ where: { id: order.id } });

    expect(saved).toMatchObject({
      customerName: CONTACT.name,
      customerPhone: CONTACT.phone,
      customerId: store.customer.id,
    });
    const detail = await getCatalogOrderDetail(order.id);
    expect(detail).toMatchObject({
      customerName: CONTACT.name,
      customerPhone: CONTACT.phone,
      customer: { id: store.customer.id, name: "Cliente Teste", deleted: false },
    });
    const loaded = await getCatalogOrderForPdv(order.id);
    expect(loaded.ok && loaded.order.customer).toEqual({
      id: store.customer.id,
      name: "Cliente Teste",
      document: null,
      phone: CONTACT.phone,
    });
  });

  it("não vincula sem cadastro, com cadastro duplicado ou excluído", async () => {
    const alone = await createOrder();
    expect(
      (await prisma.catalogOrder.findUniqueOrThrow({ where: { id: alone.id } })).customerId,
    ).toBeNull();

    await prisma.customer.update({
      where: { id: store.customer.id },
      data: { phone: CONTACT.phone },
    });
    await prisma.customer.create({ data: { name: "Outro", phone: CONTACT.phone } });
    const duplicated = await createOrder();
    expect(
      (await prisma.catalogOrder.findUniqueOrThrow({ where: { id: duplicated.id } })).customerId,
    ).toBeNull();

    await prisma.customer.updateMany({
      where: { phone: CONTACT.phone },
      data: { deletedAt: new Date() },
    });
    const deleted = await createOrder();
    expect(
      (await prisma.catalogOrder.findUniqueOrThrow({ where: { id: deleted.id } })).customerId,
    ).toBeNull();
  });

  it("cliente excluído depois do pedido não é selecionado no PDV", async () => {
    await prisma.customer.update({
      where: { id: store.customer.id },
      data: { phone: CONTACT.phone },
    });
    const order = await createOrder();
    await prisma.customer.update({
      where: { id: store.customer.id },
      data: { deletedAt: new Date() },
    });

    const loaded = await getCatalogOrderForPdv(order.id);
    expect(loaded.ok && loaded.order.customer).toBeNull();
    expect((await getCatalogOrderDetail(order.id))?.customer?.deleted).toBe(true);
  });

  it("recusa a mesma chave com outro contato", async () => {
    const key = randomUUID();
    await createOrder(orderToken(key));
    const other = await registerCatalogOrderFromLink(
      orderToken(key, undefined, { name: "Outra Pessoa", phone: "21988887777" }),
    );
    expect(other).toEqual({ success: false, error: expect.stringContaining("alterado") });
    expect(await prisma.catalogOrder.count()).toBe(1);
  });
});

describe("pedido gerado pelo link", () => {
  it("gera registro e número sem mexer em estoque, caixa, fiado ou vendas", async () => {
    const before = await effectCounts();
    const order = await createOrder();

    expect(authorize).toHaveBeenCalledWith("pdv.use");
    expect(order.code).toBe(1);
    const saved = await prisma.catalogOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    });
    expect(saved.status).toBe("OPEN");
    expect(saved.createdById).toBe(store.user.id);
    expect(saved.estimatedTotal.toString()).toBe("42.95");
    expect(saved.items).toHaveLength(2);
    expect(await effectCounts()).toEqual(before);
    expect(await stockOf(store.rice.id)).toBe("10");
    expect(await prisma.cashMovement.count()).toBe(0);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/pedidos");
  });

  it("abrir o mesmo link de novo, em sequência ou ao mesmo tempo, gera um só pedido", async () => {
    const token = orderToken();
    const first = await createOrder(token);
    const again = await createOrder(token);
    const concurrent = await Promise.all([1, 2, 3].map(() => createOrder(token)));

    expect(again.id).toBe(first.id);
    expect(concurrent.every((result) => result.id === first.id)).toBe(true);
    expect(await prisma.catalogOrder.count()).toBe(1);

    const racing = orderToken();
    const raced = await Promise.all([1, 2, 3].map(() => createOrder(racing)));
    expect(new Set(raced.map((result) => result.id)).size).toBe(1);
    expect(await prisma.catalogOrder.count()).toBe(2);
  });

  it("recusa a mesma chave com outros itens e link adulterado", async () => {
    const key = randomUUID();
    await createOrder(orderToken(key));

    const changed = await registerCatalogOrderFromLink(
      orderToken(key, [{ productId: store.rice.id, quantity: 5 }]),
    );
    expect(changed).toEqual({ success: false, error: expect.stringContaining("alterado") });
    expect(await registerCatalogOrderFromLink("abc")).toEqual({
      success: false,
      error: "Link de pedido inválido.",
    });
    expect(await prisma.catalogOrder.count()).toBe(1);
  });

  it("deixa de fora item fora do catálogo ou sem estoque e usa o preço atual", async () => {
    await prisma.product.update({
      where: { id: store.cheese.id },
      data: { currentStock: new Prisma.Decimal(0) },
    });
    await prisma.product.update({
      where: { id: store.rice.id },
      data: { salePrice: new Prisma.Decimal(12) },
    });
    const order = await createOrder();
    const detail = await getCatalogOrderDetail(order.id);

    expect(detail?.items.map((item) => [item.productName, item.unitPrice])).toEqual([
      ["Arroz 5kg", 12],
    ]);
    expect(detail?.estimatedTotal).toBe(24);
  });

  it("sem sessão ou permissão não gera nem mostra pedidos", async () => {
    const order = await createOrder();
    authorize.mockResolvedValue({ ok: false, error: "Sessão expirada. Faça login novamente." });

    expect(await registerCatalogOrderFromLink(orderToken())).toEqual({
      success: false,
      error: "Sessão expirada. Faça login novamente.",
    });
    expect(await getCatalogOrderDetail(order.id)).toBeNull();
    expect((await getCatalogOrderPage()).items).toEqual([]);
    expect((await cancelCatalogOrder({ id: order.id })).success).toBe(false);
    expect(await prisma.catalogOrder.count()).toBe(1);
  });
});

describe("conversão do pedido em venda", () => {
  it("a venda conclui o pedido e grava o vínculo", async () => {
    const order = await createOrder();
    const result = await registerSale(
      store.user.id,
      saleInput(store, { catalogOrderId: order.id }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    const saved = await prisma.catalogOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(saved.status).toBe("CONVERTED");
    expect(saved.saleId).toBe(result.data.id);
    expect(saved.convertedById).toBe(store.user.id);
    expect((await getCatalogOrderDetail(order.id))?.converted?.saleCode).toBe(result.data.code);
  });

  it("reenvio da mesma venda devolve a mesma venda sem novo efeito", async () => {
    const order = await createOrder();
    const input = saleInput(store, { catalogOrderId: order.id });
    const first = await registerSale(store.user.id, input);
    const second = await registerSale(store.user.id, input);

    expect(second).toMatchObject({ success: true, replayed: true });
    if (!first.success || !second.success) return;
    expect(second.data.id).toBe(first.data.id);
    expect((await effectCounts()).sales).toBe(1);
  });

  it("duas conclusões concorrentes produzem no máximo uma venda", async () => {
    const order = await createOrder();
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        registerSale(store.user.id, saleInput(store, { catalogOrderId: order.id })),
      ),
    );

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => !result.success)).toEqual([
      { success: false, error: CATALOG_ORDER_CLOSED_ERROR },
      { success: false, error: CATALOG_ORDER_CLOSED_ERROR },
    ]);
    expect((await effectCounts()).sales).toBe(1);
    expect(await stockOf(store.rice.id)).toBe("8");
  });

  it("pedido cancelado não vira venda e pedido convertido não é cancelado", async () => {
    const canceled = await createOrder();
    expect(await cancelCatalogOrder({ id: canceled.id, reason: "Cliente desistiu" })).toEqual({
      success: true,
    });
    const refused = await registerSale(
      store.user.id,
      saleInput(store, { catalogOrderId: canceled.id }),
    );
    expect(refused).toEqual({ success: false, error: CATALOG_ORDER_CLOSED_ERROR });
    expect((await effectCounts()).sales).toBe(0);
    expect(await stockOf(store.rice.id)).toBe("10");

    const converted = await createOrder();
    await registerSale(store.user.id, saleInput(store, { catalogOrderId: converted.id }));
    expect(await cancelCatalogOrder({ id: converted.id })).toEqual({
      success: false,
      error: CATALOG_ORDER_CLOSED_ERROR,
    });
    expect(
      (await prisma.catalogOrder.findUniqueOrThrow({ where: { id: converted.id } })).status,
    ).toBe("CONVERTED");
  });

  it("corrida entre cancelar e vender termina em estado consistente", async () => {
    for (let round = 0; round < 5; round++) {
      const order = await createOrder();
      const [cancel, sale] = await Promise.all([
        cancelCatalogOrder({ id: order.id }),
        registerSale(
          store.user.id,
          saleInput(store, {
            catalogOrderId: order.id,
            items: [{ productId: store.rice.id, quantity: 1 }],
          }),
        ),
      ]);
      const saved = await prisma.catalogOrder.findUniqueOrThrow({ where: { id: order.id } });

      expect(cancel.success !== sale.success).toBe(true);
      if (sale.success) {
        expect(saved.status).toBe("CONVERTED");
        expect(saved.saleId).toBe(sale.data.id);
      } else {
        expect(saved.status).toBe("CANCELED");
        expect(saved.saleId).toBeNull();
      }
    }
  });

  it("falha da venda desfaz tudo e o pedido continua disponível", async () => {
    const order = await createOrder();
    const result = await registerSale(
      store.user.id,
      saleInput(store, {
        catalogOrderId: order.id,
        paymentMethod: "PIX",
        items: [{ productId: store.rice.id, quantity: 50 }],
      }),
    );

    expect(result).toEqual({ success: false, error: 'Estoque insuficiente para "Arroz 5kg".' });
    const saved = await prisma.catalogOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(saved.status).toBe("OPEN");
    expect(saved.saleId).toBeNull();
    expect((await effectCounts()).sales).toBe(0);
  });
});

describe("pedido carregado no PDV", () => {
  it("informa preço alterado, item excluído e falta de estoque antes da venda", async () => {
    const extra = await prisma.product.create({
      data: {
        name: "Feijão 1kg",
        costPrice: new Prisma.Decimal(5),
        salePrice: new Prisma.Decimal(8),
        unit: "UN",
        currentStock: new Prisma.Decimal(3),
        showInCatalog: true,
      },
    });
    const order = await createOrder(
      orderToken(randomUUID(), [
        { productId: store.rice.id, quantity: 2 },
        { productId: store.cheese.id, quantity: 0.5 },
        { productId: extra.id, quantity: 3 },
      ]),
    );
    await prisma.product.update({
      where: { id: store.rice.id },
      data: { salePrice: new Prisma.Decimal(11) },
    });
    await prisma.product.update({
      where: { id: store.cheese.id },
      data: { deletedAt: new Date() },
    });
    await prisma.product.update({
      where: { id: extra.id },
      data: { currentStock: new Prisma.Decimal(1) },
    });

    const loaded = await getCatalogOrderForPdv(order.id);

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.order.lines.map((line) => [line.product.name, line.quantity])).toEqual([
      ["Arroz 5kg", 2],
      ["Feijão 1kg", 1],
    ]);
    expect(loaded.order.notices).toEqual([
      expect.stringContaining("preço alterado"),
      expect.stringContaining("Queijo minas: produto excluído"),
      expect.stringContaining("estoque permite 1 UN"),
    ]);
    // Carregar não grava nada: o pedido continua disponível
    expect((await prisma.catalogOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "OPEN",
    );
  });

  it("pedido cancelado não é carregado", async () => {
    const order = await createOrder();
    await cancelCatalogOrder({ id: order.id });
    expect(await getCatalogOrderForPdv(order.id)).toEqual({
      ok: false,
      error: CATALOG_ORDER_CLOSED_ERROR,
    });
  });
});
