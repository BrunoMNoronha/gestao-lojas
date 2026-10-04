import { expect, test, type Page } from "@playwright/test";
import { resetDatabase, seedStore, snapshot, type Store } from "./support/db";
import {
  addToCart,
  confirmCheckout,
  expectQueue,
  goOffline,
  goOnline,
  login,
  preparePdv,
  readQueue,
  takeReceipt,
} from "./support/pdv";

// Falha ao guardar a venda no aparelho (issue #39, docs/OFFLINE.md seção 4): sem espaço (cota do
// navegador) ou erro do IndexedDB. A venda não pode ser confirmada sem estar gravada: nada de
// recibo, o carrinho fica como está e a nova tentativa, depois de liberado o espaço, grava uma
// única venda.

let store: Store;

test.beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
});

/**
 * A partir de agora, gravar na fila de vendas do IndexedDB falha com o erro indicado, como o
 * navegador faz quando a cota do site acaba. Vale só para esta página, até `restoreQueueWrites`.
 */
async function failQueueWrites(page: Page, errorName: string) {
  await page.evaluate((name) => {
    const proto = IDBObjectStore.prototype;
    const saved = window as unknown as { __e2eAdd?: typeof proto.add };
    saved.__e2eAdd ??= proto.add;
    const original = saved.__e2eAdd;
    proto.add = function (this: IDBObjectStore, ...args: Parameters<typeof proto.add>) {
      if (this.name === "operations") {
        throw new DOMException("Falha de gravação simulada pelo teste.", name);
      }
      return original.apply(this, args);
    };
  }, errorName);
}

async function restoreQueueWrites(page: Page) {
  await page.evaluate(() => {
    const saved = window as unknown as { __e2eAdd?: typeof IDBObjectStore.prototype.add };
    if (saved.__e2eAdd) IDBObjectStore.prototype.add = saved.__e2eAdd;
  });
}

const FAILURES = [
  {
    title: "sem espaço no aparelho (cota)",
    error: "QuotaExceededError",
    message: "Sem espaço no aparelho para guardar a venda",
  },
  {
    title: "erro do banco do navegador",
    error: "UnknownError",
    message: "Não foi possível guardar a venda neste aparelho",
  },
];

for (const failure of FAILURES) {
  test(`${failure.title}: a venda não é confirmada e o carrinho fica`, async ({
    context,
    page,
  }) => {
    await login(context, store.seller.email);
    await preparePdv(page);
    await goOffline(context, page);

    await addToCart(page, [{ code: "ARZ", quantity: 2 }]);
    await failQueueWrites(page, failure.error);
    const checkout = await confirmCheckout(page, "PIX");

    // Sem recibo, com o motivo na tela e o carrinho intacto
    await expect(checkout.getByText(failure.message)).toBeVisible();
    await expect(checkout.getByText("O carrinho foi mantido")).toBeVisible();
    await expect(page.locator("#receipt-print-area")).toHaveCount(0);
    // O carrinho fica atrás do diálogo (fora da árvore de acessibilidade enquanto ele está aberto)
    await expect(page.locator('input[aria-label="Quantidade de Arroz 5kg"]')).toHaveValue("2");
    expect(await readQueue(page, store.seller.id)).toEqual([]);

    // Espaço liberado: a mesma venda é gravada, uma única vez
    await restoreQueueWrites(page);
    await checkout.getByRole("button", { name: "Confirmar Venda (F10)" }).click();
    const receipt = await takeReceipt(page);
    expect(receipt).toContain("PROVISÓRIA");
    expect(receipt).toContain("Arroz 5kg");
    await expect
      .poll(() => readQueue(page, store.seller.id))
      .toMatchObject([{ status: "pending" }]);
    expect(await snapshot(store)).toMatchObject({ sales: 0, operations: 0 });

    await goOnline(context, page);
    await expectQueue(page, store.seller.id, ["synced"]);
    expect(await snapshot(store)).toMatchObject({
      sales: 1,
      items: 1,
      movements: 1,
      operations: 1,
      issues: 0,
      rice: "8.000",
      cashSalesTotal: "20.00",
    });
  });
}
