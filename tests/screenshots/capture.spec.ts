import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { addToCart, goOffline, login, preparePdv, searchBox } from "../e2e/support/pdv";
import { ADMIN_EMAIL, SELLER_EMAIL, seedShowcase } from "./support/showcase";

// Capturas reais do sistema para a landing page (pnpm screenshots). Uma loja fictícia com 30 dias
// de movimento é gravada no banco descartável e cada tela é fotografada no build de produção.

type Theme = "light" | "dark";

const OUT_DIR = path.join(process.cwd(), "src/components/landing/screenshots");

async function useTheme(context: BrowserContext, page: Page, theme: Theme) {
  await context.addInitScript((value) => {
    try {
      localStorage.setItem("theme", value);
    } catch {}
  }, theme);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
}

/** Espera a tela assentar (rede, toasts e fontes) e fotografa a área visível. */
async function shoot(page: Page, name: string, { idle = true } = {}) {
  // O /pdv consulta o servidor em intervalos: lá a rede nunca fica ociosa
  if (idle) await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
  // Cursor fora das linhas/botões, para nenhum hover aparecer na foto
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.screenshot({
    path: path.join(OUT_DIR, `${name}.png`),
    animations: "disabled",
    caret: "hide",
  });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedShowcase();
});

const desktopOnly = () => test.skip(test.info().project.name !== "desktop", "só no desktop");
const mobileOnly = () => test.skip(test.info().project.name !== "mobile", "só no celular");

for (const theme of ["light", "dark"] as const) {
  const suffix = theme === "dark" ? "-dark" : "";

  test(`painel e PDV (${theme})`, async ({ context, page }) => {
    desktopOnly();
    await useTheme(context, page, theme);
    await login(context, ADMIN_EMAIL);

    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await shoot(page, `dashboard${suffix}`);

    await page.goto("/admin/pdv");
    await expect(searchBox(page)).toBeVisible();
    await addToCart(page, [
      { code: "ARZ-5", quantity: 2 },
      { code: "CAF-500", quantity: 1 },
      { code: "RAC-15", quantity: 1 },
      { code: "BAN-KG", quantity: "1,250", name: "Banana prata" },
    ]);
    await searchBox(page).fill("");
    await searchBox(page).blur();
    await shoot(page, `pdv${suffix}`);
  });
}

test("demais telas do painel", async ({ context, page }) => {
  desktopOnly();
  await useTheme(context, page, "light");
  await login(context, ADMIN_EMAIL);

  const screens: [string, string][] = [
    ["/admin/caixa", "caixa"],
    ["/admin/estoque", "estoque"],
    ["/admin/produtos", "produtos"],
    ["/admin/relatorios/vendas", "relatorios"],
    ["/admin/contas-a-receber", "contas-a-receber"],
    ["/admin/pedidos", "pedidos"],
  ];
  for (const [url, name] of screens) {
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await shoot(page, name);
  }
});

test("PDV sem internet", async ({ context, page }) => {
  desktopOnly();
  await useTheme(context, page, "light");
  // Armazenamento persistente, como no app instalado (o navegador de teste não o concede e o PDV
  // mostraria o aviso de armazenamento não garantido)
  await context.addInitScript(() => {
    if (navigator.storage) {
      navigator.storage.persisted = async () => true;
      navigator.storage.persist = async () => true;
    }
  });
  await login(context, ADMIN_EMAIL);
  await preparePdv(page);
  await addToCart(page, [
    { code: "LEI-1", quantity: 3 },
    { code: "FEJ-1", quantity: 2 },
    { code: "DET-500", quantity: 1 },
  ]);
  await searchBox(page).fill("");
  await searchBox(page).blur();
  await goOffline(context, page);
  await shoot(page, "pdv-offline", { idle: false });
});

test("celular: PDV, produtos e catálogo", async ({ context, page }) => {
  mobileOnly();
  await useTheme(context, page, "light");

  // Catálogo público, como o cliente vê (sem login)
  await page.goto("/catalogo");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shoot(page, "mobile-catalogo");

  await login(context, SELLER_EMAIL);
  await page.goto("/admin/pdv");
  await expect(searchBox(page)).toBeVisible();
  await addToCart(page, [
    { code: "MIL-25", quantity: 1 },
    { code: "NPK-5", quantity: 2 },
    { code: "AGU-15", quantity: 6 },
  ]);
  await searchBox(page).fill("");
  await searchBox(page).blur();
  await shoot(page, "mobile-pdv");

  await page.goto("/admin/produtos");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shoot(page, "mobile-produtos");
});
