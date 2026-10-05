import { expect, test, type Page } from "@playwright/test";
import { Unit } from "@prisma/client";
import { db, resetDatabase, seedStore } from "./support/db";
import {
  addToCart,
  confirmCheckout,
  expectQueue,
  goOffline,
  goOnline,
  login,
  preparePdv,
  searchBox,
  sell,
  takeReceipt,
} from "./support/pdv";

async function seedBeer() {
  const unit = await db.product.create({
    data: {
      name: "Cerveja Skol Lata 260ml 1Un",
      sku: "SKL-UN",
      unit: Unit.UN,
      costPrice: 4.67,
      salePrice: 8,
      currentStock: 0,
    },
  });
  const box = await db.product.create({
    data: {
      name: "Caixa Skol 260ml 12Un",
      sku: "SKL-CX",
      unit: Unit.CX,
      costPrice: 56,
      salePrice: 56,
      currentStock: 3,
      containedProductId: unit.id,
      unitsPerBox: 12,
    },
  });
  return { unit, box };
}

let store: Awaited<ReturnType<typeof seedStore>>;
let beer: Awaited<ReturnType<typeof seedBeer>>;

test.beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
  beer = await seedBeer();
});

const opening = (page: Page) => page.getByRole("dialog", { name: "Abrir caixas", exact: true });

async function tryUnit(page: Page) {
  await searchBox(page).fill("SKL-UN");
  await searchBox(page).press("Enter");
}

async function confirmOpening(page: Page, quantity = 1) {
  const dialog = opening(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Quantidade de caixas a abrir")).toHaveValue(String(quantity));
  await dialog.getByRole("button", { name: "Confirmar abertura", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function balances() {
  const [box, unit] = await Promise.all([
    db.product.findUniqueOrThrow({ where: { id: beer.box.id } }),
    db.product.findUniqueOrThrow({ where: { id: beer.unit.id } }),
  ]);
  return { boxes: Number(box.currentStock), units: Number(unit.currentStock) };
}

test("no PDV online, abre uma caixa e vende uma lata mantendo preços próprios", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await page.goto("/admin/pdv");
  await tryUnit(page);
  await confirmOpening(page);
  await expect(page.getByRole("textbox", { name: `Quantidade de ${beer.unit.name}` })).toHaveValue(
    "1",
  );
  expect(await balances()).toEqual({ boxes: 2, units: 12 });
  expect(await db.sale.count()).toBe(0);

  await confirmCheckout(page);
  const receipt = await takeReceipt(page);
  expect(receipt).toContain(beer.unit.name);
  expect(receipt).toContain("8,00");
  expect(await balances()).toEqual({ boxes: 2, units: 11 });
  expect(await db.unpackConversion.count()).toBe(1);
  const conversion = await db.unpackConversion.findFirstOrThrow();
  expect(await db.stockMovement.count({ where: { conversionId: conversion.id } })).toBe(2);
});

test("aumentar para 13 latas abre somente mais uma caixa e preserva 11 avulsas", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await page.goto("/admin/pdv");
  await tryUnit(page);
  await confirmOpening(page);
  const quantity = page.getByRole("textbox", { name: `Quantidade de ${beer.unit.name}` });
  await quantity.fill("13");
  await quantity.press("Enter");
  await confirmOpening(page);
  await expect(quantity).toHaveValue("13");
  await confirmCheckout(page);
  await takeReceipt(page);
  expect(await balances()).toEqual({ boxes: 1, units: 11 });
  const opened = await db.unpackConversion.aggregate({ _sum: { boxQuantity: true } });
  expect(opened._sum.boxQuantity).toBe(2);
});

test("desistir da venda depois da abertura mantém as 12 avulsas", async ({ context, page }) => {
  await login(context, store.seller.email);
  await page.goto("/admin/pdv");
  await tryUnit(page);
  await confirmOpening(page);
  await page.getByRole("button", { name: `Remover ${beer.unit.name}`, exact: true }).click();
  await expect(page.getByText("Carrinho Vazio", { exact: true })).toBeVisible();
  await page.reload();
  await expect(searchBox(page)).toBeVisible();
  expect(await balances()).toEqual({ boxes: 2, units: 12 });
  expect(await db.sale.count()).toBe(0);
  expect(await db.unpackConversion.count()).toBe(1);
});

test("carrinho misto reserva duas caixas para venda inteira e abre só a terceira", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await page.goto("/admin/pdv");
  await addToCart(page, [{ code: "SKL-CX", quantity: 2 }]);
  await tryUnit(page);
  await expect(opening(page)).toContainText("2 reservada(s) no carrinho");
  await confirmOpening(page);
  await confirmCheckout(page);
  await takeReceipt(page);
  expect(await balances()).toEqual({ boxes: 0, units: 11 });
});

test("não oferece abertura quando todas as caixas já estão no carrinho", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await page.goto("/admin/pdv");
  await addToCart(page, [{ code: "SKL-CX", quantity: 3 }]);
  await tryUnit(page);
  await expect(page.getByText(/Estoque insuficiente para/)).toBeVisible();
  await expect(opening(page)).toHaveCount(0);
  expect(await balances()).toEqual({ boxes: 3, units: 0 });
  expect(await db.unpackConversion.count()).toBe(0);
});

test("uma resposta perdida recupera a mesma abertura após recarregar", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await page.goto("/admin/pdv");
  await tryUnit(page);
  let interrupted = false;
  await page.route("**/admin/pdv", async (route) => {
    const request = route.request();
    if (
      !interrupted &&
      request.method() === "POST" &&
      request.headers()["next-action"] &&
      request.postData()?.includes(beer.box.id)
    ) {
      interrupted = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });
  await opening(page).getByRole("button", { name: "Confirmar abertura", exact: true }).click();
  await expect.poll(() => db.unpackConversion.count()).toBe(1);
  await expect(
    opening(page).getByRole("button", { name: "Verificar abertura", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(opening(page)).toBeVisible();
  await opening(page).getByRole("button", { name: "Verificar abertura", exact: true }).click();
  await expect(opening(page)).toHaveCount(0);
  expect(await db.unpackConversion.count()).toBe(1);
  expect(await balances()).toEqual({ boxes: 2, units: 12 });
  expect(await db.sale.count()).toBe(0);
});

test("no /pdv, sincroniza a conversão e continua vendendo avulsas sem internet", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await preparePdv(page);
  await tryUnit(page);
  await confirmOpening(page);
  await confirmCheckout(page);
  await takeReceipt(page);
  await expectQueue(page, store.seller.id, ["synced"]);
  await expect.poll(balances).toEqual({ boxes: 2, units: 11 });

  await goOffline(context, page);
  await sell(page, [{ code: "SKL-UN", quantity: 1 }]);
  expect(await db.unpackConversion.count()).toBe(1);
  expect(await balances()).toEqual({ boxes: 2, units: 11 });
  await goOnline(context, page);
  await expectQueue(page, store.seller.id, ["synced", "synced"]);
  await expect.poll(balances).toEqual({ boxes: 2, units: 10 });
});

test("sem internet, caixas disponíveis não criam unidades avulsas", async ({ context, page }) => {
  await login(context, store.seller.email);
  await preparePdv(page);
  await goOffline(context, page);
  await tryUnit(page);
  await expect(page.getByText(/Estoque insuficiente para/)).toBeVisible();
  await expect(opening(page)).toHaveCount(0);
  expect(await db.unpackConversion.count()).toBe(0);
  expect(await balances()).toEqual({ boxes: 3, units: 0 });
});

test("gerente vincula a caixa no cadastro e abre duas caixas no estoque sem vender", async ({
  context,
  page,
}) => {
  await db.product.update({
    where: { id: beer.box.id },
    data: { containedProductId: null, unitsPerBox: null },
  });
  await login(context, store.manager.email);
  await page.goto("/admin/produtos");
  const row = page.getByRole("row").filter({ hasText: beer.box.name });
  await row.getByRole("button", { name: "Editar produto", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Editar Produto", exact: true });
  await edit.getByLabel("Produto avulso gerado ao abrir a caixa").click();
  await page.getByRole("option", { name: beer.unit.name, exact: true }).click();
  await edit.getByLabel("Unidades por caixa").fill("12");
  await edit.getByRole("button", { name: "Atualizar Produto", exact: true }).click();
  await expect(edit).toHaveCount(0);
  expect(
    (await db.product.findUniqueOrThrow({ where: { id: beer.box.id } })).containedProductId,
  ).toBe(beer.unit.id);

  await page.goto("/admin/estoque");
  await page.getByRole("button", { name: "Caixas vinculadas", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: beer.box.name })
    .getByRole("button", { name: "Abrir caixas", exact: true })
    .click();
  await opening(page).getByLabel("Quantidade de caixas a abrir").fill("2");
  await opening(page).getByRole("button", { name: "Confirmar abertura", exact: true }).click();
  await expect(opening(page)).toHaveCount(0);
  expect(await balances()).toEqual({ boxes: 1, units: 24 });
  expect(await db.sale.count()).toBe(0);
});
