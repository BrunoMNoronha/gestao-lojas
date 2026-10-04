import { expect, test } from "@playwright/test";
import { db, resetDatabase, seedStore, snapshot, type Store } from "./support/db";
import {
  expectQueue,
  goOffline,
  goOnline,
  login,
  preparePdv,
  readQueue,
  searchBox,
  sell,
} from "./support/pdv";

// Venda sem rede de ponta a ponta (issue #39, docs/OFFLINE.md seções 3 a 5): preparar online,
// cortar a rede, recarregar, vender, reconectar e comparar o banco antes e depois.

let store: Store;

test.beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
});

test("vendas sem rede ficam no aparelho e chegam uma vez cada ao reconectar", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await preparePdv(page);
  const before = await snapshot(store);

  await goOffline(context, page);
  await page.reload();
  await expect(searchBox(page)).toBeVisible();

  const first = await sell(page, [{ code: "ARZ", quantity: 2 }], "PIX");
  expect(first).toContain("PENDENTE DE SINCRONIZAÇÃO");
  const second = await sell(
    page,
    [{ code: "QJO", quantity: "0,5", name: "Queijo minas" }],
    "Dinheiro",
  );
  expect(second).toContain("PROVISÓRIA");

  // Nada chegou ao servidor; o aparelho reserva o saldo das vendas guardadas
  expect(await snapshot(store)).toEqual(before);
  expect((await readQueue(page, store.seller.id)).map((op) => op.status)).toEqual([
    "pending",
    "pending",
  ]);
  await searchBox(page).fill("Arroz");
  await expect(page.getByText("Estoque: 8 UN")).toBeVisible();
  await searchBox(page).fill("");

  await goOnline(context, page);
  await expectQueue(page, store.seller.id, ["synced", "synced"]);

  expect(await snapshot(store)).toEqual({
    ...before,
    sales: 2,
    items: 2,
    movements: 2,
    operations: 2,
    rice: "8.000",
    cheese: "4.500",
    // 2 x 10,00 + 0,5 x 45,90
    cashSalesTotal: "42.95",
    receivables: 0,
    issues: 0,
  });
  const sales = await db.sale.findMany({
    orderBy: { code: "asc" },
    select: { cashRegisterId: true, userId: true },
  });
  expect(sales).toEqual([
    { cashRegisterId: store.cashRegister.id, userId: store.seller.id },
    { cashRegisterId: store.cashRegister.id, userId: store.seller.id },
  ]);
});

test("reconexão intermitente não duplica nem perde vendas", async ({ context, page }) => {
  await login(context, store.seller.email);
  await preparePdv(page);

  for (let round = 0; round < 3; round++) {
    await goOffline(context, page);
    await sell(page, [{ code: "ARZ", quantity: 1 }], "PIX");
    // A rede volta por um instante e cai de novo, no meio da checagem de conexão
    await context.setOffline(false);
    await page.waitForTimeout(150);
    await context.setOffline(true);
  }

  await goOnline(context, page);
  await expectQueue(page, store.seller.id, ["synced", "synced", "synced"]);
  expect(await snapshot(store)).toMatchObject({
    sales: 3,
    operations: 3,
    movements: 3,
    rice: "7.000",
    cashSalesTotal: "30.00",
  });
});
