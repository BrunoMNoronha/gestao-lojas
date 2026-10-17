import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// Capturas de tela da landing page (src/app/page.tsx). Mesmo servidor e banco descartável dos
// testes de navegador (playwright.config.ts): build de produção, TEST_DATABASE_URL e reCAPTCHA
// simulado. As imagens vão para src/components/landing/screenshots/ e entram no build por import
// estático (fora de public/, para o Service Worker não pré-baixá-las em cada PDV instalado).
//
// Uso: pnpm screenshots (faz o build e captura tudo).

// O cache de dados do catálogo (unstable_cache em src/lib/catalog.ts) fica em .next/cache e
// sobrevive entre execuções: limpo antes de subir o servidor para refletir a loja de demonstração.
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
  ],
});
