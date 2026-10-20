import { expect, test } from "@playwright/test";
import { resetDatabase, seedStore, type Store } from "./support/db";
import { connectionBadge, goOffline, login, preparePdv, searchBox } from "./support/pdv";

// Base de todos os cenários (issue #39): o /pdv preparado abre sem rede, servido pelo Service
// Worker do build de produção, e as navegações fora dele caem na página offline.

let store: Store;

test.beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
});

test("o /pdv preparado recarrega e abre sem rede pelo Service Worker", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await preparePdv(page);

  await goOffline(context, page);
  await page.reload();
  await expect(searchBox(page)).toBeVisible();
  await expect(connectionBadge(page)).toHaveText("Sem conexão com o servidor");

  // Página do painel sem rede: o Service Worker mostra a página de ajuda offline
  await page.goto("/admin/caixa");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/sem conexão|offline/i);
});
