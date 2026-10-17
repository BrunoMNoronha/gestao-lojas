import { expect, test, type Page } from "@playwright/test";
import { resetDatabase, seedStore, type Store } from "./support/db";
import { addToCart, cartItem, login, preparePdv, searchBox } from "./support/pdv";

// O carrinho do PDV nunca rola para o lado: abaixo de xl (celular e desktop estreito, com a barra
// lateral do painel e o resumo de 320px abertos) ele é uma lista em dois níveis; a partir de xl, a
// tabela. Em todas as larguras, remover, quantidade e subtotal ficam à vista.

let store: Store;

test.beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
});

const WIDTHS = [1024, 1153, 1279, 1280, 1440];

async function expectCartFits(page: Page) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    const item = cartItem(page, "Queijo minas");
    await expect(item, `item à vista em ${width}px`).toBeVisible();

    const overflow = await item.evaluate((el) => {
      const content = el.closest<HTMLElement>('[data-slot="card-content"]')!;
      return { scroll: content.scrollWidth, client: content.clientWidth };
    });
    expect(overflow.scroll, `rolagem lateral em ${width}px`).toBeLessThanOrEqual(overflow.client);

    for (const control of [
      item.getByRole("button", { name: "Remover Queijo minas" }),
      item.getByRole("textbox", { name: "Quantidade de Queijo minas" }),
      item.getByText("R$", { exact: false }).last(),
    ]) {
      await expect(control, `controle à vista em ${width}px`).toBeInViewport({ ratio: 1 });
    }
  }
}

test("o carrinho não rola para o lado entre lg e xl nem na tabela larga", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  const items = [
    { code: "ARZ", quantity: 2 },
    { code: "QJO", quantity: "0,5", name: "Queijo minas" },
  ];

  // PDV offline (sem a barra lateral do painel)
  await preparePdv(page);
  await addToCart(page, items);
  await expectCartFits(page);

  // PDV do painel, com a barra lateral de 256px a partir de lg
  await page.goto("/admin/pdv");
  await expect(searchBox(page)).toBeVisible();
  if (!(await cartItem(page, "Queijo minas").count())) await addToCart(page, items);
  await expectCartFits(page);
});
