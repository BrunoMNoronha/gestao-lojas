import { expect, test, type Page } from "@playwright/test";
import { publishNewAppVersion, restoreAppVersion } from "./support/app-version";
import { resetDatabase, seedStore, snapshot, type Store } from "./support/db";
import {
  expectQueue,
  goOffline,
  goOnline,
  login,
  preparePdv,
  readQueue,
  searchBox,
  sell,
  syncNow,
} from "./support/pdv";

// Atualização do app com vendas na fila (issue #39, docs/OFFLINE.md seções 6.1 e 6.3): nem o
// Service Worker novo nem a mudança de estrutura do banco local podem descartar vendas que ainda
// não chegaram ao servidor.

const OPERATIONS = "**/api/offline/operations";

let store: Store;

test.beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
});

test.afterEach(() => restoreAppVersion());

const pendingIds = async (page: Page) =>
  (await readQueue(page, store.seller.id))
    .filter((op) => op.status !== "synced")
    .map((op) => op.id)
    .sort();

test("versão nova do Service Worker com a fila cheia: nada se perde", async ({ context, page }) => {
  await login(context, store.seller.email);
  await preparePdv(page);

  // Servidor recusando gravar (fora do ar só para o envio): as vendas ficam na fila
  await page.route(OPERATIONS, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Banco indisponível." }),
    }),
  );
  await sell(page, [{ code: "ARZ", quantity: 1 }], "PIX");
  await sell(page, [{ code: "ARZ", quantity: 2 }], "Dinheiro");
  const queued = await pendingIds(page);
  expect(queued).toHaveLength(2);
  expect(await snapshot(store)).toMatchObject({ sales: 0, operations: 0 });

  // Deploy de uma versão nova: o navegador encontra outro Service Worker na próxima checagem
  const version = `e2e-${Date.now()}`;
  publishNewAppVersion(version);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });

  // A versão nova espera o operador; ao confirmar, a página recarrega com ela
  const update = page.getByRole("button", { name: "Atualizar o app" });
  await expect(update).toBeVisible({ timeout: 30_000 });
  const reloaded = page.waitForEvent("load");
  await update.click();
  await reloaded;
  await expect(searchBox(page)).toBeVisible();
  await expect(update).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return { waiting: !!registration?.waiting, controlled: !!navigator.serviceWorker.controller };
    }),
  ).toEqual({ waiting: false, controlled: true });
  // O /pdv aberto agora é o guardado pela versão nova
  expect(
    await page.evaluate(async (revision) => {
      for (const name of await caches.keys()) {
        const requests = await (await caches.open(name)).keys();
        if (requests.some((r) => r.url.endsWith(`/pdv?__WB_REVISION__=${revision}`))) return true;
      }
      return false;
    }, version),
  ).toBe(true);

  // A fila sobreviveu à troca de versão e é enviada uma única vez quando o servidor volta
  expect(await pendingIds(page)).toEqual(queued);
  await page.unroute(OPERATIONS);
  await syncNow(page);
  await expectQueue(page, store.seller.id, ["synced", "synced"]);
  expect(await snapshot(store)).toMatchObject({
    sales: 2,
    items: 2,
    operations: 2,
    issues: 0,
    rice: "7.000",
    cashSalesTotal: "30.00",
  });
});

/**
 * Volta o banco local do operador para a estrutura da versão 1 do app (antes da #38), com as
 * mesmas linhas, e acrescenta uma venda antiga sem os dados completos. Precisa de uma página sem
 * o banco aberto. Devolve a versão que o banco tinha.
 */
async function downgradeLocalDbToV1(page: Page, userId: string) {
  return page.evaluate(async (id) => {
    const name = `gestao-lojas-offline-${id}`;
    const request = <T>(r: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const open = (version?: number, upgrade?: (db: IDBDatabase) => void) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(name, version);
        if (upgrade) r.onupgradeneeded = () => upgrade(r.result);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.onblocked = () => reject(new Error("Banco local aberto em outra página."));
      });

    const current = await open();
    const version = current.version;
    const rows: Record<string, Record<string, unknown>[]> = {};
    for (const store of Array.from(current.objectStoreNames)) {
      rows[store] = await request(current.transaction(store).objectStore(store).getAll());
    }
    current.close();
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error("Banco local aberto em outra página."));
    });

    // Estrutura da versão 1 do Dexie (versão 10 no IndexedDB): src/lib/offline/db.ts
    const V1: Record<string, { key: string; indexes: string[] }> = {
      products: { key: "id", indexes: ["barcode", "sku", "categoryId"] },
      categories: { key: "id", indexes: [] },
      customers: { key: "id", indexes: [] },
      meta: { key: "key", indexes: [] },
      operations: { key: "id", indexes: ["status", "createdAt"] },
    };
    const old = await open(10, (db) => {
      for (const [store, { key, indexes }] of Object.entries(V1)) {
        const objectStore = db.createObjectStore(store, { keyPath: key });
        for (const index of indexes) objectStore.createIndex(index, index);
      }
    });
    const tx = old.transaction(Object.keys(V1), "readwrite");
    for (const store of Object.keys(V1)) {
      for (const row of rows[store] ?? []) {
        if (store === "operations") {
          // Campos que a versão 1 não tinha (o upgrade da versão 2 preenche)
          for (const field of ["settledAt", "approved", "appliedTxid", "conflictReason"]) {
            delete row[field];
          }
        }
        tx.objectStore(store).put(row);
      }
    }
    tx.objectStore("operations").put({
      id: "venda-antiga-sem-dados",
      status: "pending",
      createdAt: Date.now() - 60_000,
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    old.close();
    return version;
  }, userId);
}

test("banco local da versão anterior com a fila cheia: o upgrade preserva as vendas", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await preparePdv(page);
  await goOffline(context, page);
  await sell(page, [{ code: "QJO", quantity: "0,5", name: "Queijo minas" }], "PIX");
  const queued = await pendingIds(page);
  expect(queued).toHaveLength(1);

  // Sai do /pdv (fecha o banco local) e volta a estrutura para a da versão anterior
  await page.goto("/offline");
  expect(await downgradeLocalDbToV1(page, store.seller.id)).toBe(20);

  // Ainda sem rede, o /pdv abre e o Dexie migra o banco: a venda continua pendente e a linha
  // antiga sem dados fica visível como recusada, nunca apagada
  await page.goto("/pdv");
  await expect(searchBox(page)).toBeVisible();
  await expect
    .poll(async () =>
      (await readQueue(page, store.seller.id)).map((op) => [op.id, op.status]).sort(),
    )
    .toEqual(
      [...queued.map((id) => [id, "pending"]), ["venda-antiga-sem-dados", "rejected"]].sort(),
    );

  await goOnline(context, page);
  await expectQueue(page, store.seller.id, ["synced", "rejected"]);
  expect(await snapshot(store)).toMatchObject({
    sales: 1,
    items: 1,
    operations: 1,
    issues: 0,
    cheese: "4.500",
    cashSalesTotal: "22.95",
  });
});
