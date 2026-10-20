import { expect, test, type Page } from "@playwright/test";
import { Prisma } from "@prisma/client";
import { db, resetDatabase, seedStore, type Store } from "./support/db";
import {
  addToCart,
  expectQueue,
  goOffline,
  goOnline,
  login,
  preparePdv,
  searchBox,
  sell,
  syncNow,
} from "./support/pdv";

// Consulta de estoque do /pdv sem rede (issue #54, docs/OFFLINE.md seção 6.2): saldo da cópia
// menos as vendas guardadas no aparelho, estoque baixo, idade dos dados, nenhuma escrita sem
// conexão e o carrinho em montagem intacto depois de consultar.

let store: Store;

test.beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
  // Arroz: saldo 10, mínimo 8 (baixo depois de vender 2 ou mais)
  await db.product.update({
    where: { id: store.rice.id },
    data: { minStock: new Prisma.Decimal(8) },
  });
});

async function openStock(page: Page) {
  await page.getByRole("button", { name: "Estoque", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Consulta de estoque" });
  await expect(dialog).toBeVisible();
  return dialog;
}

const stockRow = (page: Page, name: string) =>
  page.getByTestId("stock-row").filter({ hasText: name });

async function closeStock(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Consulta de estoque" })).toHaveCount(0);
}

test("sem rede, consulta o saldo menos as vendas pendentes e mantém o carrinho", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await preparePdv(page);

  await goOffline(context, page);
  await page.reload();
  await expect(searchBox(page)).toBeVisible();

  // Carrinho em montagem antes de consultar
  await addToCart(page, [{ code: "ARZ", quantity: 1 }]);

  let dialog = await openStock(page);
  await expect(dialog.getByText("entrada e ajuste de estoque só com conexão")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Entrada e ajuste no painel" })).toHaveCount(0);
  await expect(dialog.getByText(/^Dados de /)).toBeVisible();
  await expect(stockRow(page, "Arroz 5kg")).toContainText("10 UN");
  await expect(stockRow(page, "Arroz 5kg")).toContainText("Normal");
  await closeStock(page);

  // O carrinho continua como estava: mais 2 e finaliza (3 no total)
  await expect(page.getByRole("textbox", { name: "Quantidade de Arroz 5kg" })).toHaveValue("1");
  const receipt = await sell(page, [{ code: "ARZ", quantity: 2 }]);
  expect(receipt).toContain("PENDENTE DE SINCRONIZAÇÃO");

  dialog = await openStock(page);
  const rice = stockRow(page, "Arroz 5kg");
  // Colunas: produto, disponível, situação, sincronizado, vendas pendentes, mínimo
  await expect(rice.getByRole("cell").nth(1)).toHaveText("7 UN");
  await expect(rice.getByRole("cell").nth(2)).toHaveText("Estoque baixo");
  await expect(rice.getByRole("cell").nth(3)).toHaveText("10 UN");
  await expect(rice.getByRole("cell").nth(4)).toHaveText("3 UN");
  await expect(rice.getByRole("cell").nth(5)).toHaveText("8 UN");

  // Filtros: só estoque baixo e busca por SKU
  await dialog.getByText("Só estoque baixo (1)").click();
  await expect(page.getByTestId("stock-row")).toHaveCount(1);
  await expect(rice).toBeVisible();
  await dialog.getByText("Só estoque baixo (1)").click();
  await dialog.getByRole("searchbox", { name: /Buscar produto/ }).fill("qjo");
  await expect(page.getByTestId("stock-row")).toHaveCount(1);
  await expect(stockRow(page, "Queijo minas")).toContainText("5,000 KG");
  await closeStock(page);

  // Reconecta: a venda chega uma vez, a cópia passa a mostrar a baixa e a reserva acaba
  await goOnline(context, page);
  await expectQueue(page, store.seller.id, ["synced"]);
  await syncNow(page);
  await expect
    .poll(async () => {
      await openStock(page);
      const cells = await stockRow(page, "Arroz 5kg").getByRole("cell").allInnerTexts();
      await closeStock(page);
      return [cells[1], cells[3], cells[4]];
    })
    // Disponível, sincronizado e vendas pendentes
    .toEqual(["7 UN", "7 UN", "-"]);
  expect(
    (await db.product.findUniqueOrThrow({ where: { id: store.rice.id } })).currentStock,
  ).toEqual(new Prisma.Decimal(7));
});

test("dados com mais de 4 horas geram aviso; mínimo ausente fica como não sincronizado", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await preparePdv(page);
  await goOffline(context, page);

  // Simula uma cópia de 5 horas atrás, guardada antes da #54 (sem o estoque mínimo)
  await page.evaluate(async (userId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`gestao-lojas-offline-${userId}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction(["meta", "products"], "readwrite");
    const meta = tx.objectStore("meta");
    const sync = await new Promise<{ key: string; value: { syncedAt: number } }>((resolve) => {
      const request = meta.get("sync");
      request.onsuccess = () => resolve(request.result);
    });
    sync.value.syncedAt = Date.now() - 5 * 60 * 60 * 1000;
    meta.put(sync);
    const products = tx.objectStore("products");
    const rows = await new Promise<Record<string, unknown>[]>((resolve) => {
      const request = products.getAll();
      request.onsuccess = () => resolve(request.result);
    });
    for (const row of rows) {
      delete row.minStock;
      products.put(row);
    }
    await new Promise((resolve) => (tx.oncomplete = resolve));
    db.close();
  }, store.seller.id);
  await page.reload();
  await expect(searchBox(page)).toBeVisible();

  const dialog = await openStock(page);
  await expect(dialog.getByText("podem estar desatualizados")).toBeVisible();
  await expect(dialog.getByText("Ele chega na próxima preparação do PDV.")).toBeVisible();
  await expect(stockRow(page, "Arroz 5kg")).toContainText("Mínimo não sincronizado");
  await expect(dialog.getByText("Só estoque baixo (0)")).toBeVisible();
});

for (const [role, hasLink] of [
  ["vendedor", false],
  ["gerente", true],
] as const) {
  test(`com conexão, link para entrada e ajuste: ${role} ${hasLink ? "vê" : "não vê"}`, async ({
    context,
    page,
  }) => {
    const user = role === "gerente" ? store.manager : store.seller;
    if (role === "gerente") {
      // O gerente também precisa de caixa aberto para preparar o PDV
      await db.cashRegister.create({
        data: { userId: user.id, openUserId: user.id, openingAmount: new Prisma.Decimal(50) },
      });
    }
    await login(context, user.email);
    await preparePdv(page);
    const dialog = await openStock(page);
    await expect(stockRow(page, "Arroz 5kg")).toBeVisible();
    const link = dialog.getByRole("link", { name: "Entrada e ajuste no painel" });
    if (hasLink) await expect(link).toHaveAttribute("href", "/admin/estoque");
    else await expect(link).toHaveCount(0);
  });
}
