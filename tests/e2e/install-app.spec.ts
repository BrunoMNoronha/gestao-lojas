import { expect, test, type Page } from "@playwright/test";
import { resetDatabase, seedStore, type Store } from "./support/db";
import { addToCart, login, preparePdv } from "./support/pdv";

// Oferta de instalação do app (issue #61). O evento `beforeinstallprompt` é simulado na página:
// isso confere a tela (botão, janela aberta uma vez, ajuda, app instalado), não a instalação
// nativa, que só se comprova num navegador real com HTTPS.

let store: Store;

test.beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
});

const installButton = (page: Page) =>
  page.getByRole("button", { name: "Instalar app Gestão Lojas" });
const helpButton = (page: Page) => page.getByRole("button", { name: "Como instalar o app" });
const helpDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Como instalar o app Gestão Lojas" });

/** Simula o aviso do navegador de que pode instalar; conta as janelas abertas em `__prompts`. */
async function offerInstall(page: Page, outcome: "accepted" | "dismissed") {
  await page.evaluate((choice) => {
    const win = window as unknown as { __prompts?: number };
    win.__prompts ??= 0;
    const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    event.prompt = async () => {
      win.__prompts! += 1;
    };
    event.userChoice = Promise.resolve({ outcome: choice });
    window.dispatchEvent(event);
  }, outcome);
}

const promptsOpened = (page: Page) =>
  page.evaluate(() => (window as unknown as { __prompts?: number }).__prompts ?? 0);

/** No celular o menu fica no drawer; no computador, na barra lateral. */
async function openMenu(page: Page) {
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: "Abrir menu" }).click();
  }
}

test("menu do painel: ajuda sem evento, janela uma vez por evento e some depois de instalado", async ({
  context,
  page,
}) => {
  await login(context, store.manager.email);
  await page.goto("/admin");
  await openMenu(page);

  // Sem o evento do navegador, o botão não promete janela: abre a ajuda
  await expect(installButton(page)).toHaveCount(0);
  await helpButton(page).click();
  await expect(helpDialog(page)).toBeVisible();
  await expect(helpDialog(page)).toContainText("Instalar não prepara o PDV");
  await expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await helpDialog(page).getByRole("button", { name: "Entendi" }).click();
  await expect(helpDialog(page)).toBeHidden();
  await expect(helpButton(page)).toBeFocused();

  // Com o evento: o clique abre a janela uma vez; recusada, o evento usado é descartado
  await offerInstall(page, "dismissed");
  await installButton(page).click();
  await expect(helpButton(page)).toBeVisible();
  expect(await promptsOpened(page)).toBe(1);
  await expect(helpDialog(page)).toBeHidden();

  // Novo evento, aceito: aviso de instalação iniciada, sem dizer que terminou
  await offerInstall(page, "accepted");
  await installButton(page).click();
  await expect(page.getByText("Instalação iniciada pelo navegador")).toBeVisible();
  expect(await promptsOpened(page)).toBe(2);

  // Instalação confirmada pelo navegador: a oferta some
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(helpButton(page)).toHaveCount(0);
  await expect(installButton(page)).toHaveCount(0);
});

test("cabeçalho do /pdv: instalar não mexe no carrinho nem recarrega a página", async ({
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await preparePdv(page);
  await addToCart(page, [{ code: "ARZ", quantity: 2 }]);
  const cartRow = page.getByRole("row").filter({ hasText: "Arroz 5kg" });
  await expect(cartRow).toBeVisible();

  // Marca na página: some se ela recarregar
  await page.evaluate(() => ((window as unknown as { __mark?: boolean }).__mark = true));
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });

  await offerInstall(page, "dismissed");
  await installButton(page).click();
  await expect(helpButton(page)).toBeVisible();
  expect(await promptsOpened(page)).toBe(1);

  await helpButton(page).click();
  await helpDialog(page).getByRole("button", { name: "Entendi" }).click();

  await expect(cartRow).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __mark?: boolean }).__mark)).toBe(true);
  expect(posts).toEqual([]);
});

test("app aberto como instalado: sem oferta no painel nem no /pdv", async ({ context, page }) => {
  await context.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query === "(display-mode: standalone)"
        ? ({ ...original(query), matches: true, media: query } as MediaQueryList)
        : original(query);
  });
  await login(context, store.manager.email);
  await page.goto("/admin");
  await openMenu(page);
  await expect(page.getByRole("button", { name: "Sair do sistema" })).toBeVisible();
  await expect(helpButton(page)).toHaveCount(0);

  // Cabeçalho do /pdv (o gerente não tem caixa aberto: basta a tela carregar)
  await page.goto("/pdv");
  await expect(page.getByRole("link", { name: "Painel" })).toBeVisible();
  await expect(helpButton(page)).toHaveCount(0);
  await expect(installButton(page)).toHaveCount(0);
});

test("manifest, ícones e Service Worker acessíveis sem login; metadados de instalação no HTML", async ({
  request,
}) => {
  const manifest = await request.get("/manifest.webmanifest", { maxRedirects: 0 });
  expect(manifest.status()).toBe(200);
  expect(manifest.headers()["content-type"]).toContain("application/manifest+json");
  const body = await manifest.json();
  expect(body).toMatchObject({
    name: "Gestão de Lojas",
    short_name: "Gestão Lojas",
    id: "/",
    start_url: "/",
    display: "standalone",
  });

  const icons = [
    ...body.icons.map((icon: { src: string }) => icon.src),
    "/icons/apple-touch-icon.png",
  ];
  for (const src of icons) {
    const icon = await request.get(src, { maxRedirects: 0 });
    expect(icon.status(), src).toBe(200);
    expect(icon.headers()["content-type"], src).toBe("image/png");
  }

  const sw = await request.get("/serwist/sw.js", { maxRedirects: 0 });
  expect(sw.status()).toBe(200);
  expect(sw.headers()["content-type"]).toContain("javascript");

  const html = await (await request.get("/login")).text();
  expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
  expect(html).toContain('rel="apple-touch-icon" href="/icons/apple-touch-icon.png"');
  expect(html).toContain('name="theme-color" content="#126a70"');
  expect(html).toContain('name="apple-mobile-web-app-title" content="Gestão Lojas"');
  expect(html).toContain('name="mobile-web-app-capable" content="yes"');
});
