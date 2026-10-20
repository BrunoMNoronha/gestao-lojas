import { expect, test } from "@playwright/test";
import { CashRegisterStatus, Prisma } from "@prisma/client";
import { db, resetDatabase, seedStore, snapshot, type Store } from "./support/db";
import { expectQueue, goOffline, goOnline, login, preparePdv, sell, syncNow } from "./support/pdv";

// Regras de negócio da sincronização vistas do navegador (issue #39, docs/OFFLINE.md seções 3.1 a
// 3.3): dois terminais com o último saldo, preço alterado e caixa fechado enquanto o aparelho
// estava sem rede. A venda feita offline já aconteceu: é aceita e vira pendência de conciliação.

let store: Store;

test.beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
});

async function issueTypes() {
  const issues = await db.reconciliationIssue.findMany({ select: { type: true } });
  return issues.map((i) => i.type).sort();
}

test("dois terminais vendem o último saldo: as duas vendas entram e o estoque fica negativo", async ({
  browser,
}) => {
  await db.product.update({
    where: { id: store.rice.id },
    data: { currentStock: new Prisma.Decimal(1) },
  });

  const terminals = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(terminals.map((context) => context.newPage()));
  for (const [index, context] of terminals.entries()) {
    await login(context, store.seller.email);
    await preparePdv(pages[index]);
  }

  for (const [index, context] of terminals.entries()) {
    await goOffline(context, pages[index]);
    await sell(pages[index], [{ code: "ARZ", quantity: 1 }], "PIX");
  }
  for (const [index, context] of terminals.entries()) {
    await goOnline(context, pages[index]);
    await expectQueue(pages[index], store.seller.id, ["synced"]);
  }

  expect(await snapshot(store)).toMatchObject({ sales: 2, operations: 2, rice: "-1.000" });
  expect(await issueTypes()).toEqual(["NEGATIVE_STOCK"]);
  expect(await db.offlineDevice.count()).toBe(2);
  await Promise.all(terminals.map((context) => context.close()));
});

test("preço alterado enquanto o aparelho estava sem rede: vale o preço praticado", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await preparePdv(page);

  await goOffline(context, page);
  await sell(page, [{ code: "ARZ", quantity: 2 }], "PIX");
  await db.product.update({
    where: { id: store.rice.id },
    data: { salePrice: new Prisma.Decimal(12) },
  });

  await goOnline(context, page);
  await expectQueue(page, store.seller.id, ["synced"]);
  const item = await db.saleItem.findFirstOrThrow();
  expect(item.unitPrice.toFixed(2)).toBe("10.00");
  expect(item.subtotal.toFixed(2)).toBe("20.00");
  expect(await issueTypes()).toEqual(["PRICE_DIVERGENCE"]);
});

test("caixa fechado no servidor: a venda vai para o caixa original como ajuste pós-fechamento", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await preparePdv(page);

  await goOffline(context, page);
  await sell(page, [{ code: "ARZ", quantity: 1 }], "Dinheiro");
  await db.cashRegister.update({
    where: { id: store.cashRegister.id },
    data: {
      status: CashRegisterStatus.CLOSED,
      openUserId: null,
      closedAt: new Date(),
      expectedAmount: new Prisma.Decimal(100),
      countedAmount: new Prisma.Decimal(100),
      difference: new Prisma.Decimal(0),
    },
  });

  // A fila é enviada logo que a conexão volta, com o caixa já fechado no servidor
  await goOnline(context, page);
  await expectQueue(page, store.seller.id, ["synced"]);
  // A tela percebe o fechamento ao atualizar a cópia (a cada 2 min ou no "Sincronizar") e pede
  // nova preparação
  await syncNow(page);
  await expect(page.getByRole("heading", { name: "Caixa fechado" })).toBeVisible();

  const sale = await db.sale.findFirstOrThrow();
  expect(sale.cashRegisterId).toBe(store.cashRegister.id);
  expect(await issueTypes()).toEqual(["POST_CLOSING_SALE"]);
  const register = await db.cashRegister.findUniqueOrThrow({
    where: { id: store.cashRegister.id },
  });
  // O resumo gravado no fechamento não muda
  expect(register.expectedAmount?.toFixed(2)).toBe("100.00");
});
