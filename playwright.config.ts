import { defineConfig, devices } from "@playwright/test";
import { testDatabaseUrl } from "./tests/integration/test-database";
import { APP_VERSION_FILE } from "./tests/e2e/support/app-version";
import { CAMERA_VIDEO } from "./tests/e2e/support/fake-camera";

// Testes de navegador dos cenários offline (issue #39, docs/OFFLINE.md). Rodam contra o build de
// produção (`next start`), porque o Service Worker só existe nele, com o mesmo PostgreSQL local e
// descartável dos testes de integração (TEST_DATABASE_URL, com "test" no nome). O login usa o
// reCAPTCHA de produção com o `siteverify` simulado no servidor (tests/e2e/support).
//
// Uso: pnpm test:e2e (faz o build e roda tudo) ou pnpm test:e2e:run (sem build).
//
// Navegadores (docs/OFFLINE.md, seção 3.5): Chrome (Chromium do Playwright), Edge instalado no
// computador e Chrome no Android emulado (tela, toque e user agent; não é um aparelho real).
// Um só: pnpm test:e2e:run --project=chromium.

const PORT = 3200;
const databaseUrl = testDatabaseUrl();

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // Os cenários compartilham o mesmo banco e o mesmo servidor: um de cada vez
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    // Câmera falsa para o leitor de código de barras: vídeo com um EAN-13 gerado no global-setup
    permissions: ["camera"],
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-video-capture=${CAMERA_VIDEO}`,
      ],
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "msedge", use: { ...devices["Desktop Edge"], channel: "msedge" } },
    { name: "android", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `node node_modules/next/dist/bin/next start -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      DATABASE_URL: databaseUrl,
      DIRECT_URL: databaseUrl,
      AUTH_SECRET: "e2e-segredo-local-de-teste-nao-usar-em-producao",
      AUTH_TRUST_HOST: "true",
      // Chave fictícia: o login exige o reCAPTCHA no build de produção, e o `siteverify` do
      // Google é simulado no processo do servidor pelo preload abaixo
      RECAPTCHA_SECRET_KEY: "e2e-chave-ficticia",
      // Versão nova do app simulada no servidor (tests/e2e/support/mock-app-version.mjs)
      E2E_APP_VERSION_FILE: APP_VERSION_FILE,
      NODE_OPTIONS: [
        "--import=./tests/e2e/support/mock-siteverify.mjs",
        "--import=./tests/e2e/support/mock-app-version.mjs",
      ].join(" "),
    },
  },
});
