import { chromium, devices, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

const baseURL = process.env.PERFORMANCE_URL ?? "http://127.0.0.1:3202";
if (!["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname))
  throw new Error("Somente servidor local de teste.");
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL, ...devices["Pixel 7"] });
const dbURL = new URL(process.env.TEST_DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(dbURL.hostname) || !dbURL.pathname.includes("test"))
  throw new Error("Banco descartável obrigatório.");
const db = new PrismaClient({ datasources: { db: { url: dbURL.href } } });
try {
  await db.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
  const { csrfToken } = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken,
      email: "perf@teste.local",
      password: "senha-de-teste-123",
      recaptchaToken: "e2e-token",
    },
    maxRedirects: 0,
  });
  const session = await (await context.request.get("/api/auth/session")).json();
  if (!session?.user) throw new Error("Login de teste recusado.");
  const counts = {
    products: await db.product.count(),
    customers: await db.customer.count(),
    sales: await db.sale.count(),
  };
  const page = await context.newPage();
  const results = [];
  for (const path of [
    "/admin/pdv",
    "/admin/produtos",
    "/admin/clientes",
    "/admin/estoque",
    "/catalogo",
    "/catalogo",
  ]) {
    await db.$executeRawUnsafe("SELECT pg_stat_statements_reset()");
    const begin = performance.now();
    const response = await context.request.get(path, { timeout: 180000 });
    expect(response.status(), path).toBe(200);
    const body = await response.text();
    const queries = await db.$queryRawUnsafe(
      "SELECT COALESCE(SUM(calls),0)::int AS calls FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND query NOT LIKE '%pg_stat_statements%' AND query NOT IN ('BEGIN','COMMIT')",
    );
    results.push({
      path,
      htmlBytes: Buffer.byteLength(body),
      responseMs: Math.round(performance.now() - begin),
      rows: (body.match(/<tr data-slot="table-row"/g) ?? []).length,
      databaseCalls: queries[0].calls,
    });
  }
  await writeFile(
    process.env.PERFORMANCE_OUTPUT ?? "performance-result.json",
    JSON.stringify({ results }, null, 2),
  );
  await page.goto("/admin/pdv");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);
  await page.keyboard.press("F4");
  const opened = await page
    .getByRole("dialog")
    .waitFor({ timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  const customerButtons = opened
    ? await page.getByRole("dialog").getByRole("button").count()
    : null;
  if (!opened) console.log((await page.locator("body").innerText()).slice(0, 1500));
  const result = { viewport: "Pixel 7", counts, results, customerButtons };
  if (process.env.PERFORMANCE_CHECK === "true") {
    expect(counts.products).toBeGreaterThanOrEqual(10_000);
    expect(counts.customers).toBeGreaterThanOrEqual(50_000);
    expect(counts.sales).toBeGreaterThanOrEqual(100_000);
    expect(results[0].htmlBytes).toBeLessThan(300_000);
    expect(results[1].rows).toBe(51);
    expect(results[2].rows).toBe(51);
    expect(customerButtons).toBeLessThanOrEqual(52); // 50 clientes, consumidor final e fechar.
    expect(results.at(-1).databaseCalls).toBe(0);
    await page.keyboard.press("Escape");
    await context.addInitScript(() => {
      window.performanceReads = { products: 0, customers: 0 };
      for (const method of ["getAll", "getAllRecords", "openCursor"]) {
        const original = IDBObjectStore.prototype[method];
        if (!original) continue;
        IDBObjectStore.prototype[method] = function (...args) {
          if (this.name in window.performanceReads) window.performanceReads[this.name]++;
          return original.apply(this, args);
        };
      }
    });
    await page.goto("/pdv");
    await page.getByRole("button", { name: "Preparar este aparelho" }).click();
    await expect(page.getByRole("textbox", { name: "Buscar produto" })).toBeVisible({
      timeout: 180_000,
    });
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker?.controller), { timeout: 60_000 })
      .toBe(true);
    await expect(page.getByText("Guardando o app no aparelho...")).toHaveCount(0);
    await context.setOffline(true);
    await expect(
      page.locator("header").getByText("Sem conexão com o servidor", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    const before = await page.evaluate(() => ({ ...window.performanceReads }));
    await page.evaluate(() => {
      window.performanceTasks = [];
      window.performanceObserver = new PerformanceObserver((list) =>
        window.performanceTasks.push(...list.getEntries().map((entry) => entry.duration)),
      );
      window.performanceObserver.observe({ type: "longtask", buffered: false });
    });
    const start = performance.now();
    await page.getByRole("textbox", { name: "Buscar produto" }).fill("P10000");
    await page.getByRole("textbox", { name: "Buscar produto" }).press("Enter");
    await page.getByRole("button", { name: "Finalizar Venda (F10)", exact: true }).click();
    const checkout = page.getByRole("dialog", { name: "Finalizar Venda", exact: true });
    await checkout.getByRole("button", { name: "PIX", exact: true }).click();
    await checkout.getByRole("button", { name: "Confirmar Venda (F10)", exact: true }).click();
    await expect(page.locator("#receipt-print-area")).toBeVisible({ timeout: 30_000 });
    const measured = await page.evaluate(() => {
      window.performanceObserver.disconnect();
      return { reads: window.performanceReads, longTasks: window.performanceTasks };
    });
    result.offline = {
      saleUiMs: Math.round(performance.now() - start),
      fullProductReads: measured.reads.products - before.products,
      fullCustomerReads: measured.reads.customers - before.customers,
      maxLongTaskMs: Math.max(0, ...measured.longTasks),
    };
    expect(result.offline.fullProductReads).toBe(0);
    expect(result.offline.fullCustomerReads).toBe(0);
    await page.getByRole("button", { name: "Nova Venda" }).click();
    // Cinco vendas reais pela interface compõem o lote; o catálogo continua com 60 mil registros.
    for (let i = 0; i < 4; i++) {
      await page.getByRole("textbox", { name: "Buscar produto" }).fill("P10000");
      await page.getByRole("textbox", { name: "Buscar produto" }).press("Enter");
      await page.getByRole("button", { name: "Finalizar Venda (F10)", exact: true }).click();
      await checkout.getByRole("button", { name: "PIX", exact: true }).click();
      await checkout.getByRole("button", { name: "Confirmar Venda (F10)", exact: true }).click();
      await expect(page.locator("#receipt-print-area")).toBeVisible();
      await page.getByRole("button", { name: "Nova Venda" }).click();
    }
    const beforeSync = await page.evaluate(() => {
      window.performanceTasks = [];
      window.performanceObserver.observe({ type: "longtask", buffered: false });
      return { ...window.performanceReads };
    });
    const syncStart = performance.now();
    await context.setOffline(false);
    await page.getByRole("textbox", { name: "Buscar produto" }).fill("P9999");
    await expect(page.getByRole("textbox", { name: "Buscar produto" })).toHaveValue("P9999");
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const local = await new Promise((resolve, reject) => {
              const request = indexedDB.open("gestao-lojas-offline-perf-user");
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            try {
              return await new Promise((resolve, reject) => {
                const request = local.transaction("operations").objectStore("operations").getAll();
                request.onsuccess = () =>
                  resolve(request.result.filter((op) => op.status === "synced").length);
                request.onerror = () => reject(request.error);
              });
            } finally {
              local.close();
            }
          }),
        { timeout: 180_000 },
      )
      .toBe(5);
    await expect(page.getByRole("button", { name: "Sincronizar", exact: true })).toBeEnabled();
    const synced = await page.evaluate(() => {
      window.performanceObserver.disconnect();
      return { reads: window.performanceReads, longTasks: window.performanceTasks };
    });
    result.sync = {
      operations: 5,
      elapsedMs: Math.round(performance.now() - syncStart),
      fullProductReads: synced.reads.products - beforeSync.products,
      fullCustomerReads: synced.reads.customers - beforeSync.customers,
      maxLongTaskMs: Math.max(0, ...synced.longTasks),
    };
    expect(result.sync.fullCustomerReads).toBe(0);
  }
  await writeFile(
    process.env.PERFORMANCE_OUTPUT ?? "performance-result.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await db.$disconnect();
}
