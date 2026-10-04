import { expect, test, type Page } from "@playwright/test";
import { Prisma } from "@prisma/client";
import { db, resetDatabase, seedStore, snapshot, type Store } from "./support/db";
import {
  addToCart,
  expectQueue,
  goOffline,
  goOnline,
  login,
  preparePdv,
  searchBox,
  syncNow,
  takeReceipt,
} from "./support/pdv";

// Carrinho em montagem guardado no aparelho (issue #53, docs/OFFLINE.md seção 6.3): recarregar o
// /pdv, com e sem rede, traz o carrinho de volta; finalizar gera uma única venda e o carrinho
// vendido não volta. Depois de sincronizar, produto excluído e preço alterado geram aviso.

let store: Store;

test.beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
});

interface StoredDraft {
  items: { productId: string; quantity: number; unitPrice: number }[];
  customer: { id: string } | null;
  discount: number;
  checkout: { paymentMethod: string } | null;
  operation: { id: string } | null;
}

/** Rascunho do carrinho no banco do operador (tabela `drafts`), ou null. */
async function readDraft(page: Page, userId: string): Promise<StoredDraft | null> {
  return page.evaluate(async (id) => {
    const name = `gestao-lojas-offline-${id}`;
    if (!(await indexedDB.databases()).some((d) => d.name === name)) return null;
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!idb.objectStoreNames.contains("drafts")) return null;
      return await new Promise<StoredDraft | null>((resolve, reject) => {
        const request = idb.transaction("drafts").objectStore("drafts").get("current");
        request.onsuccess = () => resolve((request.result as StoredDraft | undefined) ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      idb.close();
    }
  }, userId);
}

const cartRow = (page: Page, name: string) => page.getByRole("row").filter({ hasText: name });
const quantityOf = (page: Page, name: string) =>
  page.getByRole("textbox", { name: `Quantidade de ${name}` });

test("o carrinho volta ao recarregar, com e sem rede, e vira uma única venda", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await preparePdv(page);
  const before = await snapshot(store);

  // Monta o carrinho: itens, cliente e desconto
  await addToCart(page, [
    { code: "ARZ", quantity: 2 },
    { code: "QJO", quantity: "0,5", name: "Queijo minas" },
  ]);
  await page.getByRole("button", { name: "Selecionar Cliente (F4)" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Cliente Teste/ })
    .click();
  await page.getByRole("textbox", { name: "Desconto em reais" }).fill("1,50");
  await expect.poll(async () => (await readDraft(page, store.seller.id))?.discount).toBe(1.5);

  // Sem rede, recarrega: o carrinho volta inteiro
  await goOffline(context, page);
  await page.reload();
  await expect(searchBox(page)).toBeVisible();
  await expect(page.getByText("Carrinho da venda em andamento restaurado.")).toBeVisible();
  await expect(quantityOf(page, "Arroz 5kg")).toHaveValue("2");
  await expect(quantityOf(page, "Queijo minas")).toHaveValue("0,500");
  await expect(page.getByText("Cliente Teste")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Desconto em reais" })).toHaveValue(/1,50/);

  // Com rede, abre o pagamento, escolhe Débito e recarrega: volta no pagamento
  await goOnline(context, page);
  await page.getByRole("button", { name: "Finalizar Venda (F10)" }).click();
  const checkout = page.getByRole("dialog", { name: "Finalizar Venda" });
  await checkout.getByRole("button", { name: "Débito", exact: true }).click();
  await expect
    .poll(async () => (await readDraft(page, store.seller.id))?.checkout?.paymentMethod)
    .toBe("DEBIT_CARD");
  await page.reload();
  await expect(checkout).toBeVisible();
  await expect(checkout.getByRole("button", { name: "Débito", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Total: 2 x 10,00 + 0,5 x 45,90 - 1,50 = 41,45
  await expect(checkout.getByText(/41,45/)).toBeVisible();

  await checkout.getByRole("button", { name: "Confirmar Venda (F10)" }).click();
  const receipt = await takeReceipt(page);
  expect(receipt).toContain("Cliente Teste");
  expect(await readDraft(page, store.seller.id)).toBeNull();
  await expectQueue(page, store.seller.id, ["synced"]);

  // Recarregar logo depois de vender não traz o carrinho vendido de volta
  await page.reload();
  await expect(searchBox(page)).toBeVisible();
  await expect(page.getByText("Carrinho Vazio")).toBeVisible();
  expect(await snapshot(store)).toMatchObject({
    sales: before.sales + 1,
    operations: before.operations + 1,
    rice: "8.000",
    cheese: "4.500",
  });
  const [sale] = await db.sale.findMany({ select: { total: true, customerId: true } });
  expect({ total: sale.total.toFixed(2), customerId: sale.customerId }).toEqual({
    total: "41.45",
    customerId: store.customer.id,
  });
});

test("produto excluído e preço alterado depois da sincronização: o carrinho avisa", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await preparePdv(page);

  await addToCart(page, [
    { code: "ARZ", quantity: 2 },
    { code: "QJO", quantity: 1 },
  ]);
  await expect.poll(async () => (await readDraft(page, store.seller.id))?.items.length).toBe(2);

  // No servidor: o arroz sobe de preço e o queijo é excluído; a cópia do aparelho recebe
  await db.product.update({
    where: { id: store.rice.id },
    data: { salePrice: new Prisma.Decimal("12.50") },
  });
  await db.product.update({ where: { id: store.cheese.id }, data: { deletedAt: new Date() } });
  await syncNow(page);
  // Espera a cópia mostrar o preço novo (a busca lê a cópia local)
  await searchBox(page).fill("ARZ");
  await expect(page.getByRole("button", { name: /Arroz 5kg.*12,50/ })).toBeVisible();
  await searchBox(page).fill("");

  await page.reload();
  await expect(searchBox(page)).toBeVisible();
  const notice = page.getByRole("alert").filter({ hasText: "saiu do carrinho" });
  await expect(notice).toContainText('"Queijo minas" saiu do carrinho');
  await expect(notice).toContainText('O preço de "Arroz 5kg" mudou');
  await expect(cartRow(page, "Arroz 5kg")).toContainText("25,00");
  await expect(cartRow(page, "Queijo minas")).toHaveCount(0);

  // "Limpar Carrinho" apaga o rascunho
  await page.getByRole("button", { name: "Limpar Carrinho" }).click();
  await expect.poll(() => readDraft(page, store.seller.id)).toBeNull();
  await page.reload();
  await expect(page.getByText("Carrinho Vazio")).toBeVisible();
});
