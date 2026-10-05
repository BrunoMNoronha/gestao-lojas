import { expect, test } from "@playwright/test";
import { db, resetDatabase, seedStore, type Store } from "./support/db";
import { login, searchBox, confirmCheckout, takeReceipt } from "./support/pdv";

let store: Store;
test.beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
  await db.product.createMany({
    data: Array.from({ length: 75 }, (_, i) => ({
      name: `Extra ${String(i).padStart(3, "0")}`,
      sku: `EX${i}`,
      costPrice: 6,
      salePrice: 10,
      currentStock: 50,
    })),
  });
  await db.customer.createMany({
    data: Array.from({ length: 75 }, (_, i) => ({ name: `Cliente ${String(i).padStart(3, "0")}` })),
  });
});

test("PDV limita clientes, encontra item fora da primeira página e vende sem recarregar", async ({
  page,
  context,
}) => {
  await login(context, store.seller.email);
  const response = await context.request.get("/admin/pdv");
  expect((await response.body()).length).toBeLessThan(300_000);
  await page.goto("/admin/pdv");
  await expect(searchBox(page)).toBeVisible();
  await page.getByRole("button", { name: /Cliente.*F4/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button").filter({ hasText: /^Cliente / })).toHaveCount(50);
  await dialog.getByRole("textbox").fill("Cliente 074");
  await dialog.getByRole("button", { name: /Cliente 074/ }).click();
  await searchBox(page).fill("QJO");
  await searchBox(page).press("Enter");
  await expect(page.getByRole("textbox", { name: "Quantidade de Queijo minas" })).toHaveValue(
    "1,000",
  );
  let navigations = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.resourceType() === "document") navigations++;
  });
  await confirmCheckout(page);
  await takeReceipt(page);
  expect(navigations).toBe(0);
  expect(await db.sale.count()).toBe(1);
  expect(
    Number((await db.product.findUniqueOrThrow({ where: { id: store.cheese.id } })).currentStock),
  ).toBe(4);
});

test("listas buscam no servidor, paginam e edição atualiza a página com uma resposta", async ({
  page,
  context,
}) => {
  await login(context, store.manager.email);
  await page.goto("/admin/produtos");
  await expect(page.locator("tbody tr")).toHaveCount(50);
  await page.getByRole("button", { name: "Próxima", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(27);
  await page.getByRole("textbox", { name: "Buscar produto" }).fill("Queijo minas");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page).toHaveURL(/q=Queijo/);
  await page.getByRole("button", { name: "Editar produto", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Editar Produto", exact: true });
  await edit.getByLabel(/Preço de Venda/).fill("5000");
  let extraRsc = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname === "/admin/produtos" &&
      url.searchParams.has("_rsc")
    )
      extraRsc++;
  });
  await edit.getByRole("button", { name: "Atualizar Produto", exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.locator("tbody tr")).toContainText("50,00");
  expect(extraRsc).toBe(0);
  await page.goto("/admin/clientes");
  await expect(page.locator("tbody tr")).toHaveCount(50);
  await page.getByRole("textbox", { name: "Buscar cliente" }).fill("Cliente 074");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("Cliente 074");
});

test("preço público é invalidado pela edição do produto", async ({ page, context }) => {
  await db.storeSettings.create({
    data: { id: "default", companyName: "Teste", tradeName: "Teste", catalogEnabled: true },
  });
  await db.product.update({ where: { id: store.rice.id }, data: { showInCatalog: true } });
  await login(context, store.manager.email);
  await page.goto("/admin/produtos");
  const changePrice = async (value: string) => {
    await page
      .getByRole("row")
      .filter({ hasText: "Arroz 5kg" })
      .getByRole("button", { name: "Editar produto", exact: true })
      .click();
    const edit = page.getByRole("dialog", { name: "Editar Produto", exact: true });
    await edit.getByLabel(/Preço de Venda/).fill(value);
    await edit.getByRole("button", { name: "Atualizar Produto", exact: true }).click();
    await expect(edit).toHaveCount(0);
  };
  await changePrice("1100");
  const publicPage = await context.newPage();
  await publicPage.goto(`/catalogo/${store.rice.id}`);
  await expect(publicPage.locator("main")).toContainText("11,00");
  await changePrice("1200");
  await publicPage.reload();
  await expect(publicPage.locator("main")).toContainText("12,00");
});
