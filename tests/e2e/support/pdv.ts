import { expect, type BrowserContext, type Page } from "@playwright/test";
import { PASSWORD } from "./db";

// Ações do /pdv nos testes de navegador: entrar, preparar o aparelho, vender pela tela, cortar e
// restaurar a rede e ler a fila de vendas guardada no IndexedDB.

/**
 * Entra pelo endpoint do Auth.js (o mesmo do formulário), com o cookie no contexto do navegador.
 * O token do reCAPTCHA é fictício: o servidor de teste simula o `siteverify`.
 */
export async function login(context: BrowserContext, email: string) {
  const csrf = await context.request.get("/api/auth/csrf");
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const response = await context.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken,
      email,
      password: PASSWORD,
      recaptchaToken: "e2e-token",
      callbackUrl: "/pdv",
    },
    maxRedirects: 0,
  });
  expect(response.status(), "login recusado").toBeLessThan(400);
  const session = await (await context.request.get("/api/auth/session")).json();
  expect(session?.user?.email, "sessão não criada").toBe(email);
}

/** Encerra a sessão (cookie apagado), como uma sessão expirada. */
export async function expireSession(context: BrowserContext) {
  await context.clearCookies();
}

export const searchBox = (page: Page) => page.getByRole("textbox", { name: "Buscar produto" });

/** Abre o /pdv, prepara o aparelho e espera o terminal e o Service Worker no controle. */
export async function preparePdv(page: Page) {
  await page.goto("/pdv");
  await page.getByRole("button", { name: "Preparar este aparelho" }).click();
  await expect(searchBox(page)).toBeVisible();
  await waitForServiceWorker(page);
}

/** O Service Worker ativo controla a página (o /pdv já fica guardado para abrir sem rede). */
export async function waitForServiceWorker(page: Page) {
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker?.controller), {
      message: "Service Worker não assumiu o controle da página",
      timeout: 30_000,
    })
    .toBe(true);
  await expect(page.getByText("Guardando o app no aparelho...")).toHaveCount(0);
}

export const connectionBadge = (page: Page) => page.locator("header [role=status] > span").first();

export async function goOffline(context: BrowserContext, page: Page) {
  await context.setOffline(true);
  await expect(connectionBadge(page)).toHaveText("Sem conexão com o servidor");
}

export async function goOnline(context: BrowserContext, page: Page) {
  await context.setOffline(false);
  await expect(connectionBadge(page)).toHaveText("Conectado ao servidor");
}

export type Payment = "Dinheiro" | "PIX" | "Crédito" | "Débito";

export interface SaleLine {
  // SKU ou código de barras
  code: string;
  // Unidades (cada uma é um Enter na busca) ou quantidade digitada (ex.: "0,5" kg)
  quantity: number | string;
  // Nome do produto, para a quantidade digitada
  name?: string;
}

/**
 * Faz uma venda pela tela e devolve o texto do recibo. Funciona com e sem conexão: no /pdv a
 * venda sempre entra na fila do aparelho antes de o recibo aparecer.
 */
export async function sell(page: Page, lines: SaleLine[], payment: Payment = "PIX") {
  for (const line of lines) {
    const units = typeof line.quantity === "number" ? line.quantity : 1;
    for (let i = 0; i < units; i++) {
      await searchBox(page).fill(line.code);
      await searchBox(page).press("Enter");
    }
    if (typeof line.quantity === "string") {
      const input = page.getByRole("textbox", { name: `Quantidade de ${line.name}` });
      await input.click();
      await input.fill(line.quantity);
      await input.press("Enter");
    }
  }
  await page.getByRole("button", { name: "Finalizar Venda (F10)" }).click();
  const checkout = page.getByRole("dialog", { name: "Finalizar Venda" });
  await checkout.getByRole("button", { name: payment, exact: true }).click();
  await checkout.getByRole("button", { name: "Confirmar Venda (F10)" }).click();

  const receipt = page.locator("#receipt-print-area");
  await expect(receipt).toBeVisible();
  const text = await receipt.innerText();
  await page.getByRole("button", { name: "Nova Venda" }).click();
  await expect(receipt).toHaveCount(0);
  return text;
}

export interface QueuedOperation {
  id: string;
  status: string;
  attempts: number;
  saleCode: number | null;
}

/** Fila de vendas do operador no IndexedDB do aparelho (banco `gestao-lojas-offline-<id>`). */
export async function readQueue(page: Page, userId: string): Promise<QueuedOperation[]> {
  return page.evaluate(async (id) => {
    const name = `gestao-lojas-offline-${id}`;
    const exists = (await indexedDB.databases()).some((db) => db.name === name);
    if (!exists) return [];
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains("operations")) return [];
      const rows = await new Promise<
        { id: string; status: string; attempts: number; sale: { code: number } | null }[]
      >((resolve, reject) => {
        const request = db.transaction("operations").objectStore("operations").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return rows.map((r) => ({
        id: r.id,
        status: r.status,
        attempts: r.attempts,
        saleCode: r.sale?.code ?? null,
      }));
    } finally {
      db.close();
    }
  }, userId);
}

/** Espera todas as vendas da fila chegarem a um estado (ex.: "synced"). */
export async function expectQueue(page: Page, userId: string, statuses: string[]) {
  await expect
    .poll(async () => (await readQueue(page, userId)).map((op) => op.status).sort(), {
      timeout: 45_000,
    })
    .toEqual([...statuses].sort());
}

/** Botão "Sincronizar" do cabeçalho: envia a fila e atualiza a cópia na hora. */
export async function syncNow(page: Page) {
  await page.getByRole("button", { name: "Sincronizar" }).click();
}
