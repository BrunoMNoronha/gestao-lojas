import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { registerSale } from "@/lib/create-sale";
import type { SessionUser } from "@/lib/authz";
import {
  readOfflineSnapshot,
  type OfflineProduct,
  type OfflineSnapshot,
} from "@/lib/offline-snapshot";
import { resetDatabase, saleInput, seedStore, type Store } from "./fixtures";

// Cópia local dos dados do PDV (issue #36, docs/OFFLINE.md seções 3.8 e 5): carga completa,
// alterações incrementais com exclusões, cursor sem perdas sob gravação concorrente e só os
// campos permitidos. A sessão do Auth.js é simulada no teste do Route Handler.
const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("@/lib/authz", () => ({ authorize }));

const { GET } = await import("@/app/api/offline/snapshot/route");

let store: Store;
let user: SessionUser;

beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
  user = { id: store.user.id, name: store.user.name, role: "SELLER" };
  authorize.mockReset();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

/** Lê todas as páginas a partir do cursor (como o aparelho faz enquanto houver hasMore). */
async function readAll(cursor: string | null, limit?: number) {
  const pages: OfflineSnapshot[] = [];
  let next = cursor;
  do {
    const page = await readOfflineSnapshot(user, { cursor: next, limit });
    pages.push(page);
    next = page.cursor;
  } while (pages[pages.length - 1].hasMore);
  return {
    pages,
    cursor: next!,
    products: pages.flatMap((page) => page.products),
    categories: pages.flatMap((page) => page.categories),
    customers: pages.flatMap((page) => page.customers),
  };
}

describe("readOfflineSnapshot", () => {
  it("carga completa traz só os campos permitidos ao aparelho", async () => {
    const category = await prisma.category.create({ data: { name: "Grãos" } });
    await prisma.product.update({
      where: { id: store.rice.id },
      data: {
        categoryId: category.id,
        sku: "ARR-5",
        barcode: "7890000000001",
        description: "Tipo 1",
        imageUrl: "https://exemplo.test/arroz.png",
        minStock: 3,
      },
    });
    await prisma.customer.update({
      where: { id: store.customer.id },
      data: {
        document: "52998224725",
        phone: "11999998888",
        email: "cliente@teste.local",
        address: "Rua A, 1",
      },
    });
    await prisma.storeSettings.create({
      data: {
        companyName: "Loja Teste LTDA",
        tradeName: "Loja Teste",
        document: "11222333000181",
        email: "loja@teste.local",
        onAccountCreditLimit: new Prisma.Decimal(500),
      },
    });

    const snapshot = await readOfflineSnapshot(user);

    expect(snapshot.protocolVersion).toBe(1);
    expect(snapshot.reset).toBe(true);
    expect(snapshot.hasMore).toBe(false);
    expect(snapshot.products.find((p) => p.id === store.rice.id)).toEqual({
      id: store.rice.id,
      deleted: false,
      name: "Arroz 5kg",
      sku: "ARR-5",
      barcode: "7890000000001",
      salePrice: "10.00",
      unit: "UN",
      currentStock: "10.000",
      minStock: "3.000",
      categoryId: category.id,
      updatedAt: expect.any(String),
    });
    // Nunca: preço de custo, descrição, imagem (cada campo, em todos os produtos)
    for (const product of snapshot.products) {
      for (const field of ["costPrice", "description", "imageUrl"]) {
        expect(product).not.toHaveProperty(field);
      }
    }
    expect(snapshot.categories).toEqual([{ id: category.id, deleted: false, name: "Grãos" }]);
    // Cliente: nome e documento mascarado; nada de telefone, e-mail ou endereço
    expect(snapshot.customers).toEqual([
      { id: store.customer.id, deleted: false, name: "Cliente Teste", document: "***.982.247-**" },
    ]);
    expect(snapshot.store).toEqual({
      personType: "COMPANY",
      companyName: "Loja Teste LTDA",
      tradeName: "Loja Teste",
      document: "11222333000181",
      phone: null,
      zipCode: null,
      address: null,
      number: null,
      neighborhood: null,
      city: null,
      state: null,
      receiptFooterNote: null,
    });
    expect(snapshot.cashRegister).toEqual({
      id: store.cashRegister.id,
      openedAt: store.cashRegister.openedAt.toISOString(),
      openingAmount: "100.00",
    });
    expect(snapshot.user).toEqual(user);
  });

  it("estoque mínimo vai a todos os perfis, e o preço de custo a nenhum (#54)", async () => {
    await prisma.product.update({
      where: { id: store.rice.id },
      data: { minStock: new Prisma.Decimal("2.5"), costPrice: new Prisma.Decimal("7.35") },
    });

    for (const role of ["SELLER", "MANAGER", "ADMIN"] as const) {
      const snapshot = await readOfflineSnapshot({ ...user, role });
      const rice = snapshot.products.find((p) => p.id === store.rice.id);
      expect(rice).toMatchObject({ minStock: "2.500" });
      expect(rice).not.toHaveProperty("costPrice");
    }
  });

  it("sem caixa aberto do operador, cashRegister vem nulo", async () => {
    await prisma.cashRegister.update({
      where: { id: store.cashRegister.id },
      data: { openUserId: null, status: "CLOSED", closedAt: new Date() },
    });

    const snapshot = await readOfflineSnapshot(user);

    expect(snapshot.cashRegister).toBeNull();
  });

  it("incremental devolve só o que mudou, inclusive a baixa de estoque da venda", async () => {
    const full = await readAll(null);
    expect(ids(full.products)).toEqual(ids([store.rice, store.cheese]));

    const idle = await readOfflineSnapshot(user, { cursor: full.cursor });
    expect(idle.reset).toBe(false);
    expect([...idle.products, ...idle.categories, ...idle.customers]).toEqual([]);

    // Venda online: a baixa usa updateMany (sem passar pelo Prisma no gatilho de versão)
    const sale = await registerSale(
      store.user.id,
      saleInput(store, { items: [{ productId: store.rice.id, quantity: 3 }] }),
    );
    expect(sale.success).toBe(true);

    const changed = await readOfflineSnapshot(user, { cursor: idle.cursor });
    expect(changed.products).toEqual([
      expect.objectContaining({ id: store.rice.id, currentStock: "7.000" }),
    ]);

    // Mudança de preço e cadastro de cliente novo
    await prisma.product.update({
      where: { id: store.cheese.id },
      data: { salePrice: new Prisma.Decimal("49.90") },
    });
    const newCustomer = await prisma.customer.create({ data: { name: "Novo" } });

    const next = await readOfflineSnapshot(user, { cursor: changed.cursor });
    expect(next.products).toEqual([
      expect.objectContaining({ id: store.cheese.id, salePrice: "49.90" }),
    ]);
    expect(next.customers).toEqual([
      { id: newCustomer.id, deleted: false, name: "Novo", document: null },
    ]);

    // Estoque mínimo alterado no cadastro chega pelo incremental (#54)
    await prisma.product.update({
      where: { id: store.rice.id },
      data: { minStock: new Prisma.Decimal(8) },
    });
    const minChanged = await readOfflineSnapshot(user, { cursor: next.cursor });
    expect(minChanged.products).toEqual([
      expect.objectContaining({ id: store.rice.id, minStock: "8.000", currentStock: "7.000" }),
    ]);
  });

  it("exclusões chegam ao aparelho só com o id", async () => {
    const category = await prisma.category.create({ data: { name: "Laticínios" } });
    const full = await readAll(null);

    const now = new Date();
    await prisma.product.update({ where: { id: store.cheese.id }, data: { deletedAt: now } });
    await prisma.category.update({ where: { id: category.id }, data: { deletedAt: now } });
    await prisma.customer.update({ where: { id: store.customer.id }, data: { deletedAt: now } });

    const next = await readOfflineSnapshot(user, { cursor: full.cursor });

    expect(next.products).toEqual([{ id: store.cheese.id, deleted: true }]);
    expect(next.categories).toEqual([{ id: category.id, deleted: true }]);
    expect(next.customers).toEqual([{ id: store.customer.id, deleted: true }]);
  });

  it("pagina sem repetir nem pular registros", async () => {
    for (let i = 1; i <= 5; i++) {
      await prisma.product.create({
        data: { name: `Produto ${i}`, costPrice: 1, salePrice: i },
      });
    }

    const all = await readAll(null, 2);

    expect(all.pages.length).toBe(4); // 7 produtos, 2 por página
    expect(all.products.length).toBe(7);
    expect(new Set(all.products.map((p) => p.id)).size).toBe(7);
    expect(all.pages.slice(0, -1).every((page) => page.hasMore)).toBe(true);
    expect(all.pages.every((page) => page.products.length <= 2)).toBe(true);
  });

  it("transação lenta que confirma depois da leitura não é perdida", async () => {
    const full = await readAll(null);

    // A: altera o arroz e fica aberta. B: altera o queijo depois e confirma antes de A.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    const slow = prisma.$transaction(
      async (tx) => {
        await tx.product.update({ where: { id: store.rice.id }, data: { salePrice: 11 } });
        markStarted();
        await gate;
      },
      { timeout: 20_000 },
    );
    await started;
    await prisma.product.update({ where: { id: store.cheese.id }, data: { salePrice: 50 } });

    // Leitura com A em andamento: B fica para depois (está acima do limite seguro)
    const during = await readOfflineSnapshot(user, { cursor: full.cursor });
    expect(during.products).toEqual([]);

    release();
    await slow;

    // Um cursor por updatedAt teria pulado A: ela gravou um horário anterior ao de B
    const rice = await prisma.product.findUniqueOrThrow({ where: { id: store.rice.id } });
    const cheese = await prisma.product.findUniqueOrThrow({ where: { id: store.cheese.id } });
    expect(rice.updatedAt.getTime()).toBeLessThanOrEqual(cheese.updatedAt.getTime());

    const after = await readOfflineSnapshot(user, { cursor: during.cursor });
    expect(ids(after.products)).toEqual(ids([store.rice, store.cheese]));
    const prices = Object.fromEntries(
      after.products.map((p: OfflineProduct) => [p.id, "salePrice" in p ? p.salePrice : null]),
    );
    expect(prices).toEqual({ [store.rice.id]: "11.00", [store.cheese.id]: "50.00" });
  });
});

describe("GET /api/offline/snapshot", () => {
  const request = (query = "") => new Request(`http://localhost/api/offline/snapshot${query}`);

  it("sem sessão responde 401 e sem permissão 403, sem consultar dados", async () => {
    authorize.mockResolvedValueOnce({
      ok: false,
      error: "Sessão expirada. Faça login novamente.",
      code: "unauthenticated",
    });
    const noSession = await GET(request());
    expect(noSession.status).toBe(401);
    expect(await noSession.json()).toEqual({
      error: "Sessão expirada. Faça login novamente.",
      code: "unauthenticated",
    });

    authorize.mockResolvedValueOnce({
      ok: false,
      error: "Você não tem permissão para realizar esta ação.",
      code: "forbidden",
    });
    const forbidden = await GET(request());
    expect(forbidden.status).toBe(403);
    expect(authorize).toHaveBeenCalledWith("pdv.use");
  });

  it("devolve a cópia sem cache e recusa cursor ou limite inválido", async () => {
    authorize.mockResolvedValue({ ok: true, user });

    const ok = await GET(request("?limit=1"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const body = (await ok.json()) as OfflineSnapshot;
    expect(body.products.length).toBe(1);
    expect(body.hasMore).toBe(true);

    const next = await GET(request(`?limit=1&cursor=${body.cursor}`));
    expect(next.status).toBe(200);

    for (const query of ["?cursor=nao-e-cursor!", "?cursor=e30", "?limit=0", "?limit=5000"]) {
      const bad = await GET(request(query));
      expect(bad.status).toBe(400);
    }
  });
});
