import { defineConfig, devices } from "@playwright/test";
import { testDatabaseUrl } from "./tests/integration/test-database";

// Testes de navegador dos cenários offline (issue #39, docs/OFFLINE.md). Rodam contra o build de
// produção (`next start`), porque o Service Worker só existe nele, com o mesmo PostgreSQL local e
// descartável dos testes de integração (TEST_DATABASE_URL, com "test" no nome). O login usa o
// reCAPTCHA de produção com o `siteverify` simulado no servidor (tests/e2e/support).
//
// Uso: pnpm test:e2e (faz o build e roda tudo) ou pnpm test:e2e:run (sem build).

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
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
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
      NODE_OPTIONS: "--import=./tests/e2e/support/mock-siteverify.mjs",
    },
  },
});
