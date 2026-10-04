import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma, Role } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/authz";
import { registerSale } from "@/lib/create-sale";
import {
  buildTestData,
  createSeededRandom,
  TEST_DATA_LIMITS,
  type TestDataCounts,
} from "@/lib/test-data-generator";
import {
  generateTestData,
  getDataEpoch,
  getResetBlockers,
  KEPT_TABLES,
  MAX_RESET_CONFIRMATION_FAILURES,
  RESET_TABLES,
  resetStoreData,
} from "@/lib/test-data";
import { prepareOffline, resetDatabase, saleInput, seedStore } from "./fixtures";

// Dados de teste e restauração do banco (issue #57): geração coerente e idempotente, sem tocar no
// que existe; restauração só com confirmação, sem impedimentos, apagando a lista fechada de
// tabelas e mantendo usuários, configurações da loja e o histórico.

const PASSWORD = "senha-do-admin-123";
const TRADE_NAME = "Loja Teste";
const MAX: TestDataCounts = { ...TEST_DATA_LIMITS };

let admin: SessionUser;

async function createAdmin() {
  const user = await prisma.user.create({
    data: {
      name: "Admin Teste",
      email: `${randomUUID()}@teste.local`,
      password: await bcrypt.hash(PASSWORD, 4),
      role: Role.ADMIN,
    },
  });
  return { id: user.id, name: user.name, role: "ADMIN" } satisfies SessionUser;
}

async function saveSettings() {
  return prisma.storeSettings.create({
    data: { id: "default", companyName: "Loja Teste Ltda", tradeName: TRADE_NAME },
  });
}

const confirm = { tradeName: TRADE_NAME, password: PASSWORD };

async function tableCounts() {
  const columns = RESET_TABLES.map((t) => `(SELECT count(*) FROM "${t}")::int AS "${t}"`);
  const [row] = await prisma.$queryRawUnsafe<Record<string, number>[]>(
    `SELECT ${columns.join(", ")}`,
  );
  return row;
}

/** Para cada produto: saldo igual à soma das movimentações. */
async function expectStockMatchesMovements() {
  const rows = await prisma.$queryRaw<{ id: string; stock: string; moved: string | null }[]>`
    SELECT p.id, p."currentStock"::text AS stock,
           (SELECT sum(m.quantity) FROM "StockMovement" m WHERE m."productId" = p.id)::text AS moved
    FROM "Product" p
  `;
  for (const row of rows) {
    expect(new Prisma.Decimal(row.moved ?? 0).equals(new Prisma.Decimal(row.stock))).toBe(true);
  }
}

beforeEach(async () => {
  await resetDatabase();
  admin = await createAdmin();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("generateTestData", () => {
  it("gera as quantidades pedidas com estoque coerente e histórico", async () => {
    const requestId = randomUUID();
    const result = await generateTestData(admin, requestId, MAX, createSeededRandom(1));

    expect(result).toEqual({
      ok: true,
      replayed: false,
      counts: { categories: 15, products: 50, customers: 10, suppliers: 5, stockMovements: 50 },
    });
    const counts = await tableCounts();
    expect(counts).toMatchObject({
      Category: 15,
      Product: 50,
      Customer: 10,
      Supplier: 5,
      StockMovement: 50,
      ProductPrice: 50,
    });
    await expectStockMatchesMovements();

    const supplierIds = new Set((await prisma.supplier.findMany()).map((s) => s.id));
    const movements = await prisma.stockMovement.findMany();
    for (const movement of movements) {
      expect(movement.type).toBe("IN");
      expect(movement.userId).toBe(admin.id);
      expect(supplierIds.has(movement.supplierId!)).toBe(true);
      expect(movement.unitCost).not.toBeNull();
    }
    const products = await prisma.product.findMany();
    expect(products.every((p) => !p.showInCatalog && p.categoryId && p.deletedAt === null)).toBe(
      true,
    );
    expect(products.every((p) => p.syncVersion > BigInt(0))).toBe(true);

    const run = await prisma.testDataRun.findUniqueOrThrow({ where: { id: requestId } });
    expect(run).toMatchObject({ kind: "GENERATE", status: "COMPLETED", userId: admin.id });
    expect(run.params).toEqual(MAX);
  });

  it("não altera cadastros existentes e evita nomes, códigos e documentos já usados", async () => {
    const seed = 99;
    const planned = buildTestData(MAX, createSeededRandom(seed));
    const store = await seedStore();
    await saveSettings();
    await prisma.category.create({ data: { name: planned.categories[0].name } });
    await prisma.product.update({
      where: { id: store.rice.id },
      data: { sku: planned.products[0].sku, barcode: planned.products[0].barcode },
    });
    // Documento gravado com a pontuação antiga também conta
    const cpf = planned.customers[0].document;
    await prisma.customer.update({
      where: { id: store.customer.id },
      data: {
        document: `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`,
      },
    });
    await prisma.supplier.create({
      data: { name: "Fornecedor Real", document: planned.suppliers[0].document },
    });

    const snapshot = async () => ({
      products: await prisma.product.findMany({ orderBy: { id: "asc" } }),
      customers: await prisma.customer.findMany({ orderBy: { id: "asc" } }),
      categories: await prisma.category.findMany({ orderBy: { id: "asc" } }),
      suppliers: await prisma.supplier.findMany({ orderBy: { id: "asc" } }),
      registers: await prisma.cashRegister.findMany(),
      settings: await prisma.storeSettings.findMany(),
    });
    const before = await snapshot();

    const result = await generateTestData(admin, randomUUID(), MAX, createSeededRandom(seed));
    expect(result.ok).toBe(true);

    const after = await snapshot();
    for (const key of ["products", "customers", "categories", "suppliers"] as const) {
      const previous: { id: string }[] = before[key];
      const current: { id: string }[] = after[key];
      const previousIds = new Set(previous.map((row) => row.id));
      expect(current.filter((row) => previousIds.has(row.id))).toEqual(previous);
      expect(current).toHaveLength(previous.length + MAX[key]);
    }
    expect(after.registers).toEqual(before.registers);
    expect(after.settings).toEqual(before.settings);

    const generated = await prisma.product.findMany({
      where: { id: { notIn: [store.rice.id, store.cheese.id] } },
    });
    expect(generated).toHaveLength(MAX.products);
    expect(generated.some((p) => p.sku === planned.products[0].sku)).toBe(false);
    expect(generated.some((p) => p.barcode === planned.products[0].barcode)).toBe(false);
    expect(await prisma.customer.count({ where: { document: cpf } })).toBe(0);
    expect(
      await prisma.supplier.count({ where: { document: planned.suppliers[0].document } }),
    ).toBe(1);
    expect(
      await prisma.category.count({ where: { name: `${planned.categories[0].name} 2` } }),
    ).toBe(1);
    // Os produtos existentes não ganharam movimentação
    expect(
      await prisma.stockMovement.count({
        where: { productId: { in: [store.rice.id, store.cheese.id] } },
      }),
    ).toBe(0);
  });

  it("repetir o mesmo pedido devolve o resultado gravado sem gerar de novo", async () => {
    const requestId = randomUUID();
    const counts = { categories: 2, products: 4, customers: 1, suppliers: 1 };
    const first = await generateTestData(admin, requestId, counts);
    const second = await generateTestData(admin, requestId, counts);

    expect(first.ok && !first.replayed).toBe(true);
    expect(second).toEqual({ ...first, replayed: true });
    expect(await prisma.product.count()).toBe(4);
    expect(await prisma.testDataRun.count()).toBe(1);
  });

  it("dois pedidos simultâneos ficam em sequência, sem colidir", async () => {
    const counts = { categories: 3, products: 20, customers: 5, suppliers: 2 };
    const results = await Promise.all([
      generateTestData(admin, randomUUID(), counts),
      generateTestData(admin, randomUUID(), counts),
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    const products = await prisma.product.findMany();
    expect(products).toHaveLength(40);
    expect(new Set(products.map((p) => p.sku)).size).toBe(40);
    expect(await prisma.category.count()).toBe(6);
    await expectStockMatchesMovements();
  });

  it("recusa quantidades acima do teto e pedido inválido sem gravar dados", async () => {
    const above = await generateTestData(admin, randomUUID(), { ...MAX, products: 51 });
    expect(above).toEqual({ ok: false, error: expect.stringMatching(/produtos/) });

    const invalid = await generateTestData(admin, "nao-e-uuid", MAX);
    expect(invalid.ok).toBe(false);

    expect(Object.values(await tableCounts()).every((n) => n === 0)).toBe(true);
    const runs = await prisma.testDataRun.findMany();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ kind: "GENERATE", status: "REJECTED" });
  });

  it("falha no meio desfaz tudo e o mesmo pedido pode ser repetido", async () => {
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_movement() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'falha simulada'; END $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fail_movement BEFORE INSERT ON "StockMovement"
      FOR EACH ROW EXECUTE FUNCTION test_fail_movement()
    `);
    const requestId = randomUUID();
    try {
      const failed = await generateTestData(admin, requestId, MAX);
      expect(failed).toEqual({ ok: false, error: expect.stringMatching(/Nada foi gravado/) });
      expect(Object.values(await tableCounts()).every((n) => n === 0)).toBe(true);
      const runs = await prisma.testDataRun.findMany();
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ status: "FAILED" });
      expect(runs[0].id).not.toBe(requestId);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER test_fail_movement ON "StockMovement"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION test_fail_movement()`);
    }

    const retry = await generateTestData(admin, requestId, MAX);
    expect(retry.ok).toBe(true);
    expect(await prisma.product.count()).toBe(MAX.products);
  });
});

describe("resetStoreData", () => {
  /** Loja com movimento: geração, venda, fiado e aparelho; caixa fechado no fim. */
  async function busyStore() {
    await saveSettings();
    await generateTestData(admin, randomUUID(), { ...MAX, products: 10 });
    const store = await seedStore();
    const sale = await registerSale(store.user.id, saleInput(store));
    expect(sale.success).toBe(true);
    await prepareOffline(store.user.id, store.cashRegister.id);
    await prisma.cashRegister.update({
      where: { id: store.cashRegister.id },
      data: { status: "CLOSED", openUserId: null, closedAt: new Date() },
    });
    return store;
  }

  it("apaga a lista fechada e mantém usuários, configurações e histórico", async () => {
    await busyStore();
    const usersBefore = await prisma.user.findMany({ orderBy: { id: "asc" } });
    const settingsBefore = await prisma.storeSettings.findMany();
    const countsBefore = await tableCounts();
    const runsBefore = await prisma.testDataRun.count();
    expect(countsBefore.Sale).toBe(1);

    const requestId = randomUUID();
    const result = await resetStoreData(admin, requestId, confirm);

    expect(result).toEqual({ ok: true, replayed: false, counts: countsBefore });
    expect(Object.values(await tableCounts()).every((n) => n === 0)).toBe(true);
    expect(await prisma.user.findMany({ orderBy: { id: "asc" } })).toEqual(usersBefore);
    expect(await prisma.storeSettings.findMany()).toEqual(settingsBefore);
    expect(await prisma.testDataRun.count()).toBe(runsBefore + 1);
    expect(await getDataEpoch()).toBe("1");

    // A numeração das vendas recomeça
    const store = await seedStore();
    const sale = await registerSale(store.user.id, saleInput(store));
    expect(sale.success && sale.data.code).toBe(1);
  });

  it("repetir o pedido concluído não apaga de novo", async () => {
    await saveSettings();
    const requestId = randomUUID();
    expect((await resetStoreData(admin, requestId, confirm)).ok).toBe(true);
    await generateTestData(admin, randomUUID(), { ...MAX, products: 5 });

    const replay = await resetStoreData(admin, requestId, {});
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(await prisma.product.count()).toBe(5);
  });

  it("recusa com caixa aberto e lista o impedimento", async () => {
    await saveSettings();
    const store = await seedStore();

    const result = await resetStoreData(admin, randomUUID(), confirm);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers?.openCashRegisters).toEqual([
        { id: store.cashRegister.id, userName: store.user.name, openedAt: expect.any(String) },
      ]);
    }
    expect(await prisma.product.count()).toBe(2);
    const run = await prisma.testDataRun.findFirstOrThrow();
    expect(run).toMatchObject({ kind: "RESET", status: "REJECTED" });
  });

  it("recusa com aparelho que informou vendas offline não enviadas", async () => {
    const store = await busyStore();
    const { device, grant } = await prepareOffline(store.user.id, store.cashRegister.id);
    await prisma.offlineGrant.update({
      where: { id: grant.id },
      data: { pendingCount: 3, pendingReportedAt: new Date() },
    });

    const blockers = await getResetBlockers();
    expect(blockers.openCashRegisters).toEqual([]);
    expect(blockers.pendingDevices).toEqual([
      expect.objectContaining({ deviceId: device.id, pending: 3 }),
    ]);
    const result = await resetStoreData(admin, randomUUID(), confirm);
    expect(result).toMatchObject({ ok: false, blockers });
    expect(await prisma.sale.count()).toBe(1);

    // Aparelho revogado não impede
    await prisma.offlineDevice.update({
      where: { id: device.id },
      data: { revokedAt: new Date() },
    });
    expect((await resetStoreData(admin, randomUUID(), confirm)).ok).toBe(true);
  });

  it("recusa nome da loja ou senha errados com a mesma mensagem", async () => {
    await busyStore();
    const wrongName = await resetStoreData(admin, randomUUID(), { ...confirm, tradeName: "Outra" });
    const wrongPassword = await resetStoreData(admin, randomUUID(), {
      ...confirm,
      password: "errada",
    });
    const empty = await resetStoreData(admin, randomUUID(), {});

    for (const result of [wrongName, wrongPassword, empty]) {
      expect(result).toEqual({ ok: false, error: "Nome da loja ou senha incorretos." });
    }
    expect(await prisma.sale.count()).toBe(1);
  });

  it("aceita o nome com espaços nas pontas", async () => {
    await saveSettings();
    const result = await resetStoreData(admin, randomUUID(), {
      ...confirm,
      tradeName: `  ${TRADE_NAME} `,
    });
    expect(result.ok).toBe(true);
  });

  it("exige configurações da loja salvas", async () => {
    const result = await resetStoreData(admin, randomUUID(), confirm);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/configurações da loja/) });
  });

  it("bloqueia depois de muitas tentativas erradas", async () => {
    await saveSettings();
    await generateTestData(admin, randomUUID(), { ...MAX, products: 3 });
    for (let i = 0; i < MAX_RESET_CONFIRMATION_FAILURES; i++) {
      await resetStoreData(admin, randomUUID(), { ...confirm, password: "errada" });
    }

    const blocked = await resetStoreData(admin, randomUUID(), confirm);
    expect(blocked).toEqual({ ok: false, error: expect.stringMatching(/Aguarde 15 minutos/) });
    expect(await prisma.product.count()).toBe(3);

    // Passada a janela, a confirmação correta volta a valer
    const later = new Date(Date.now() + 16 * 60 * 1000);
    expect((await resetStoreData(admin, randomUUID(), confirm, later)).ok).toBe(true);
  });

  it("geração e restauração simultâneas ficam em sequência, sem efeito parcial", async () => {
    await saveSettings();
    await generateTestData(admin, randomUUID(), MAX);

    const [generated, reset] = await Promise.all([
      generateTestData(admin, randomUUID(), MAX),
      resetStoreData(admin, randomUUID(), confirm),
    ]);

    expect(generated.ok && reset.ok).toBe(true);
    const products = await prisma.product.count();
    expect([0, MAX.products]).toContain(products);
    expect(await prisma.stockMovement.count()).toBe(products);
    expect(await prisma.customer.count()).toBe(products === 0 ? 0 : MAX.customers);
    await expectStockMatchesMovements();
  });

  it("toda tabela do banco está classificada como apagada ou mantida", async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `;
    const classified = [...RESET_TABLES, ...KEPT_TABLES].sort();
    expect(tables.map((t) => t.tablename).sort()).toEqual(classified);
  });
});

describe("getDataEpoch", () => {
  it("é vazia sem restauração e muda a cada restauração concluída", async () => {
    await saveSettings();
    expect(await getDataEpoch()).toBe("");
    await resetStoreData(admin, randomUUID(), confirm);
    expect(await getDataEpoch()).toBe("1");
    // Recusa e repetição do mesmo pedido não mudam a época
    await resetStoreData(admin, randomUUID(), { ...confirm, password: "errada" });
    const second = randomUUID();
    await resetStoreData(admin, second, confirm);
    await resetStoreData(admin, second, confirm);
    expect(await getDataEpoch()).toBe("2");
  });
});
