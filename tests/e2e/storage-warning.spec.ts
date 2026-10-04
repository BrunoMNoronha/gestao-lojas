import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { resetDatabase, seedStore, type Store } from "./support/db";
import { addToCart, goOffline, login, preparePdv, readQueue, sell } from "./support/pdv";

// Aviso "Armazenamento não garantido pelo navegador" do /pdv (issue #59): com a persistência não
// confirmada, o aviso abre um diálogo explicativo por clique, toque ou teclado, também sem rede.
// Abrir e fechar não prepara o aparelho de novo, não sincroniza e não mexe no carrinho nem na fila.

let store: Store;

test.beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
});

/** Resposta de navigator.storage.persist() nesta aba, antes de qualquer script da página. */
async function persistAnswers(context: BrowserContext, granted: boolean) {
  await context.addInitScript((value) => {
    const storage = navigator.storage as StorageManager & { persist: () => Promise<boolean> };
    storage.persist = () => Promise.resolve(value);
  }, granted);
}

const warning = (page: Page) =>
  page.getByRole("button", { name: "Armazenamento não garantido pelo navegador" });
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "Sobre o armazenamento neste aparelho" });

/** Carrinho em montagem guardado no aparelho (tabela `drafts`), para comparar antes e depois. */
async function readDraft(page: Page, userId: string) {
  return page.evaluate(async (id) => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`gestao-lojas-offline-${id}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const request = idb.transaction("drafts").objectStore("drafts").get("current");
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      idb.close();
    }
  }, userId);
}

test("persistência não confirmada: o aviso explica o risco sem mexer em carrinho e fila", async ({
  context,
  page,
}, testInfo) => {
  await persistAnswers(context, false);
  await login(context, store.seller.email);
  await preparePdv(page);

  // Uma venda na fila e um carrinho em montagem, sem rede
  await goOffline(context, page);
  await sell(page, [{ code: "ARZ", quantity: 1 }]);
  await addToCart(page, [{ code: "QJO", quantity: 2 }]);
  await expect.poll(() => readDraft(page, store.seller.id)).not.toBeNull();
  const queueBefore = await readQueue(page, store.seller.id);
  const draftBefore = await readDraft(page, store.seller.id);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") requests.push(request.url());
  });

  // Clique ou toque abre o diálogo com todo o conteúdo, sem conexão com o servidor
  await expect(warning(page)).toBeVisible();
  if (testInfo.project.use.hasTouch) await warning(page).tap();
  else await warning(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText("podem ser apagados pelo navegador");
  await expect(dialog(page)).toContainText("Sincronizar");
  await expect(dialog(page)).toContainText("Vendas deste aparelho");
  await expect(dialog(page)).toContainText("aba anônima");
  await expect(dialog(page)).toContainText("não significa que uma venda já foi perdida");

  // Legível na tela: nada cortado nem rolagem horizontal
  const box = await dialog(page).boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  // "Entendi" fecha e devolve o foco ao aviso
  await dialog(page).getByRole("button", { name: "Entendi" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(warning(page)).toBeFocused();

  // Teclado: Enter abre e Escape fecha; Espaço abre e o "Fechar" fecha
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect(warning(page)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Fechar" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(warning(page)).toBeFocused();

  // Nada mudou no aparelho e nenhuma chamada ao servidor foi feita
  expect(await readQueue(page, store.seller.id)).toEqual(queueBefore);
  expect(await readDraft(page, store.seller.id)).toEqual(draftBefore);
  expect(requests).toEqual([]);
});

test("persistência confirmada ou aparelho ainda não preparado: sem aviso", async ({
  context,
  page,
}) => {
  await persistAnswers(context, true);
  await login(context, store.seller.email);

  // Sem preparação, não há metadados: o aviso não aparece
  await page.goto("/pdv");
  await expect(page.getByRole("button", { name: "Preparar este aparelho" })).toBeVisible();
  await expect(warning(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Preparar este aparelho" }).click();
  await expect(page.getByRole("textbox", { name: "Buscar produto" })).toBeVisible();
  await expect(page.getByText("Conectado ao servidor")).toBeVisible();
  await expect(warning(page)).toHaveCount(0);
});
