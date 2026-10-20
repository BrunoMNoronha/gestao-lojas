import { expect, test } from "@playwright/test";
import { db, resetDatabase, seedStore, snapshot, type Store } from "./support/db";
import {
  expectQueue,
  expireSession,
  goOffline,
  login,
  preparePdv,
  readQueue,
  sell,
} from "./support/pdv";

// Operador e sessão (issue #39, docs/OFFLINE.md seções 3.5 e 7): operador desativado durante a
// desconexão, troca de usuário com fila no aparelho e sessão expirada. Uma venda guardada nunca é
// enviada por outro operador comum nem apagada; quem não pode mais enviar depende de um gerente.

let store: Store;

test.beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
});

test("operador desativado: a venda fica no aparelho e o gerente a envia para conferência", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await preparePdv(page);

  await goOffline(context, page);
  await sell(page, [{ code: "ARZ", quantity: 1 }], "PIX");
  await db.user.update({ where: { id: store.seller.id }, data: { active: false } });

  // De volta à rede, o servidor recusa a sessão do operador desativado: vai para o login, que
  // explica o motivo (sem laço de redirecionamento com o cookie ainda válido)
  await context.setOffline(false);
  await expect(page).toHaveURL(/\/login\?sessao=invalida/);
  await expect(page.getByText("Sua sessão não vale mais")).toBeVisible();
  expect(await snapshot(store)).toMatchObject({ sales: 0, operations: 0 });
  expect((await readQueue(page, store.seller.id)).map((op) => op.status)).toEqual(["pending"]);

  await login(context, store.manager.email);
  await page.goto("/pdv");
  await page.getByRole("button", { name: "1 de outros operadores" }).click();
  await page.getByRole("button", { name: "Enviar para conferência" }).click();
  await expectQueue(page, store.seller.id, ["conflict"]);

  const operation = await db.syncOperation.findFirstOrThrow();
  expect(operation).toMatchObject({
    status: "CONFLICT",
    conflictReason: "ASSISTED_SUBMISSION",
    userId: store.seller.id,
    submittedById: store.manager.id,
  });
  expect(await snapshot(store)).toMatchObject({ sales: 0, rice: "10.000" });
});

test("troca de usuário: a fila do operador anterior fica oculta e segue quando ele volta", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await preparePdv(page);

  await goOffline(context, page);
  await sell(page, [{ code: "ARZ", quantity: 2 }], "PIX");
  await page.getByRole("button", { name: "Encerrar neste aparelho" }).click();
  await page.getByRole("button", { name: "Encerrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "PDV indisponível sem conexão" })).toBeVisible();

  // Outro vendedor entra no mesmo aparelho
  await expireSession(context);
  await context.setOffline(false);
  await expect(page).toHaveURL(/\/login/);
  await login(context, store.otherSeller.email);
  await page.goto("/pdv");
  await expect(page.getByRole("button", { name: "Preparar este aparelho" })).toBeVisible();
  await expect(page.getByRole("button", { name: /outros operadores/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /venda a enviar|Vendas sincronizadas/ }),
  ).toHaveCount(0);
  expect(await snapshot(store)).toMatchObject({ sales: 0, operations: 0 });
  expect((await readQueue(page, store.seller.id)).map((op) => op.status)).toEqual(["pending"]);

  // A dona da fila volta: a venda é enviada com a autoria dela
  await expireSession(context);
  await login(context, store.seller.email);
  await page.goto("/pdv");
  await expectQueue(page, store.seller.id, ["synced"]);
  const sale = await db.sale.findFirstOrThrow();
  expect(sale.userId).toBe(store.seller.id);
  expect(await snapshot(store)).toMatchObject({ sales: 1, operations: 1, rice: "8.000" });
});

test("sessão expirada: nada é enviado até entrar de novo, e então a venda segue", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await preparePdv(page);

  await goOffline(context, page);
  await sell(page, [{ code: "QJO", quantity: "1,25", name: "Queijo minas" }], "Crédito");
  await expireSession(context);

  await context.setOffline(false);
  await expect(page).toHaveURL(/\/login/);
  expect(await snapshot(store)).toMatchObject({ sales: 0, operations: 0 });
  expect((await readQueue(page, store.seller.id)).map((op) => op.status)).toEqual(["pending"]);

  await login(context, store.seller.email);
  await page.goto("/pdv");
  await expectQueue(page, store.seller.id, ["synced"]);
  // 1,25 kg x 45,90 = 57,375 → 57,38
  expect(await snapshot(store)).toMatchObject({
    sales: 1,
    cheese: "3.750",
    cashSalesTotal: "57.38",
  });
});
