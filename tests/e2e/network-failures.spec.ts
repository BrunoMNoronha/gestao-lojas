import { expect, test, type Page } from "@playwright/test";
import { resetDatabase, seedStore, snapshot, type Store } from "./support/db";
import {
  connectionBadge,
  expectQueue,
  goOffline,
  goOnline,
  login,
  preparePdv,
  readQueue,
  sell,
  syncNow,
} from "./support/pdv";

// Falhas de rede com o servidor no envio da fila (issue #39, docs/OFFLINE.md seções 4 e 5):
// resposta perdida depois de o banco gravar, servidor fora do ar com a internet ativa e lote
// processado só em parte. Reenviar é sempre seguro: cada venda é gravada uma única vez.

const OPERATIONS = "**/api/offline/operations";

let store: Store;

test.beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
});

/** Força a checagem de conexão agora (o /pdv também confere a cada 30 s). */
const recheck = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("online")));

test("resposta perdida depois da gravação: o reenvio não duplica a venda", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await preparePdv(page);

  let lost = 0;
  await page.route(OPERATIONS, async (route) => {
    const response = await route.fetch(); // o servidor grava a venda
    if (lost === 0) {
      lost += 1;
      await route.abort("failed"); // e a resposta não chega ao aparelho
    } else {
      await route.fulfill({ response });
    }
  });

  const receipt = await sell(page, [{ code: "ARZ", quantity: 1 }], "PIX");
  expect(receipt).toContain("PROVISÓRIA");
  await expect.poll(() => readQueue(page, store.seller.id)).toMatchObject([{ status: "failed" }]);
  expect(await snapshot(store)).toMatchObject({ sales: 1, operations: 1 });

  await syncNow(page);
  await expectQueue(page, store.seller.id, ["synced"]);
  const [op] = await readQueue(page, store.seller.id);
  expect(op.attempts).toBe(2);
  expect(op.saleCode).toBe(1);
  expect(await snapshot(store)).toMatchObject({
    sales: 1,
    operations: 1,
    movements: 1,
    rice: "9.000",
  });
});

test("servidor fora do ar com a internet ativa: a venda espera e segue depois", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await preparePdv(page);

  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Banco indisponível." }),
    }),
  );
  await recheck(page);
  await expect(connectionBadge(page)).toHaveText("Sem conexão com o servidor");

  await sell(page, [{ code: "ARZ", quantity: 2 }], "Débito");
  expect(await snapshot(store)).toMatchObject({ sales: 0, operations: 0 });
  expect((await readQueue(page, store.seller.id)).map((op) => op.status)).toEqual(["pending"]);

  await page.unroute("**/api/**");
  await recheck(page);
  await expectQueue(page, store.seller.id, ["synced"]);
  expect(await snapshot(store)).toMatchObject({ sales: 1, operations: 1, rice: "8.000" });
});

test("lote processado em parte: o restante é reenviado e cada venda entra uma vez", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await preparePdv(page);

  await goOffline(context, page);
  for (let i = 0; i < 3; i++) await sell(page, [{ code: "ARZ", quantity: 1 }], "PIX");

  // O primeiro lote chega ao servidor só com a primeira venda (ex.: conexão caiu no meio)
  let partial = true;
  await page.route(OPERATIONS, async (route) => {
    if (!partial) return route.continue();
    partial = false;
    const body = JSON.parse(route.request().postData() ?? "{}");
    const response = await route.fetch({
      postData: JSON.stringify({ ...body, operations: body.operations.slice(0, 1) }),
    });
    await route.fulfill({ response });
  });

  await goOnline(context, page);
  await expect
    .poll(async () => (await readQueue(page, store.seller.id)).map((op) => op.status).sort())
    .toEqual(["failed", "failed", "synced"]);
  expect(await snapshot(store)).toMatchObject({ sales: 1, operations: 1 });

  await syncNow(page);
  await expectQueue(page, store.seller.id, ["synced", "synced", "synced"]);
  expect(await snapshot(store)).toMatchObject({
    sales: 3,
    operations: 3,
    movements: 3,
    rice: "7.000",
  });
  const codes = (await readQueue(page, store.seller.id)).map((op) => op.saleCode).sort();
  expect(codes).toEqual([1, 2, 3]);
});
