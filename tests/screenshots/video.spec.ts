import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { confirmCheckout, login, searchBox } from "../e2e/support/pdv";
import { SCAN_BARCODE } from "./support/scan";
import { ADMIN_EMAIL, seedShowcase } from "./support/showcase";

// Vídeo da landing page (pnpm screenshots, projeto "video"): no PDV, a câmera lê o código de barras
// do café, o produto entra no carrinho, a venda é finalizada no PIX e o comprovante aparece.
// O Playwright grava a página em WebM; o quadro final (comprovante) vira o pôster do vídeo.

const VIDEO_DIR = path.join(process.cwd(), "public/videos");
const POSTER = path.join(process.cwd(), "src/components/landing/screenshots/video-poster.png");
const SIZE = { width: 1280, height: 800 };

/** Pausa para quem assiste acompanhar cada passo. */
const beat = (page: Page, ms = 900) => page.waitForTimeout(ms);

test("PDV: ler o código pela câmera, finalizar e gerar o comprovante", async ({ browser }) => {
  test.setTimeout(180_000);
  await seedShowcase();
  const tmp = path.join(test.info().outputDir, "raw");
  rmSync(tmp, { recursive: true, force: true });
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: SIZE,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    permissions: ["camera"],
    colorScheme: "light",
    reducedMotion: "no-preference",
    recordVideo: { dir: tmp, size: SIZE },
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("theme", "light");
    } catch {}
  });
  await login(context, ADMIN_EMAIL);
  const page = await context.newPage();

  await page.goto("/admin/pdv");
  await expect(searchBox(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
  await beat(page, 1200);

  await page.getByRole("button", { name: "Ler código pela câmera" }).click();
  const scanner = page.getByRole("dialog", { name: "Ler produtos pela câmera" });
  await expect(scanner).toBeVisible();
  await expect(
    page.getByText(`Café torrado e moído 500 g adicionado (${SCAN_BARCODE}).`),
  ).toBeVisible({
    timeout: 30_000,
  });
  await beat(page, 1500);
  await scanner.getByRole("button", { name: "Concluir" }).click();
  await expect(scanner).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Quantidade de Café torrado e moído 500 g" }),
  ).toHaveValue("1");
  await beat(page, 1200);

  await confirmCheckout(page, "PIX");
  const receipt = page.locator("#receipt-print-area");
  await expect(receipt).toBeVisible();
  await beat(page, 2500);
  await page.screenshot({ path: POSTER, animations: "disabled", caret: "hide" });

  const video = page.video()!;
  await context.close();
  mkdirSync(VIDEO_DIR, { recursive: true });
  await video.saveAs(path.join(VIDEO_DIR, "pdv-leitor-codigo.webm"));
});
