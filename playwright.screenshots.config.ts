import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";
import { writeBarcodeVideo } from "./tests/e2e/support/fake-camera";
import { SCAN_BARCODE, SCAN_VIDEO } from "./tests/screenshots/support/scan";

// Capturas de tela da landing page (src/app/page.tsx). Mesmo servidor e banco descartável dos
// testes de navegador (playwright.config.ts): build de produção, TEST_DATABASE_URL e reCAPTCHA
// simulado. As imagens vão para src/components/landing/screenshots/ e entram no build por import
// estático (fora de public/, para o Service Worker não pré-baixá-las em cada PDV instalado).
//
// Uso: pnpm screenshots (faz o build e captura tudo).

// O cache de dados do catálogo (unstable_cache em src/lib/catalog.ts) fica em .next/cache e
// sobrevive entre execuções: limpo antes de subir o servidor para refletir a loja de demonstração.
writeBarcodeVideo(SCAN_BARCODE, SCAN_VIDEO);

const clearDataCache = `node -e "require('fs').rmSync('.next/cache/fetch-cache',{recursive:true,force:true})"`;

export default defineConfig({
  ...base,
  webServer: base.webServer && {
    ...base.webServer,
    command: `${clearDataCache} && ${(base.webServer as { command: string }).command}`,
  },
  testDir: "tests/screenshots",
  reporter: [["list"]],
  timeout: 180_000,
  testIgnore: "video.spec.ts",
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    // Vídeo do PDV (public/videos/): câmera falsa com o EAN do café e ações mais lentas
    {
      name: "video",
      testMatch: "video.spec.ts",
      testIgnore: [],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        launchOptions: {
          slowMo: 120,
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            `--use-file-for-fake-video-capture=${SCAN_VIDEO}`,
          ],
        },
      },
    },
  ],
});
