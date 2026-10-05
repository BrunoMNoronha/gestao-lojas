import { expect, test, type Page } from "@playwright/test";
import { Prisma, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { db, PASSWORD, resetDatabase, seedStore, type Store } from "./support/db";
import { login, preparePdv, searchBox } from "./support/pdv";

// Seção "Dados de teste" em Configurações (issue #57): o ADMIN gera dados e restaura o banco pela
// tela, com impedimento por caixa aberto e confirmação forte; os demais perfis não chegam à seção;
// um PDV preparado antes da restauração recebe a carga completa e não mostra os dados apagados.
// Issue #67: a remoção seletiva tira só os registros gerados.

const TRADE_NAME = "Loja E2E";
const ADMIN_EMAIL = "admin@teste.local";

let store: Store;

test.beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
  await db.user.create({
    data: {
      name: "Admin Dora",
      email: ADMIN_EMAIL,
      password: await bcrypt.hash(PASSWORD, 4),
      role: Role.ADMIN,
    },
  });
  await db.storeSettings.create({
    data: { id: "default", companyName: "Loja E2E Ltda", tradeName: TRADE_NAME },
  });
});

const testDataSection = (page: Page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: "Dados de teste" }) });

const history = (page: Page) =>
  page.getByRole("list", { name: "Histórico de execuções" }).getByRole("listitem");

async function closeCashRegister() {
  await db.cashRegister.update({
    where: { id: store.cashRegister.id },
    data: { status: "CLOSED", openUserId: null, closedAt: new Date() },
  });
}

/** Restaura pela tela: abre o diálogo, confirma com nome fantasia e senha e espera o aviso. */
async function restoreViaUi(page: Page) {
  await page.goto("/admin/configuracoes");
  await page.getByRole("button", { name: "Restaurar banco…" }).click();
  const dialog = page.getByRole("dialog", { name: "Restaurar banco" });
  await dialog.getByLabel(/^Digite/).fill(TRADE_NAME);
  await dialog.getByLabel("Sua senha").fill(PASSWORD);
  await dialog.getByRole("button", { name: "Apagar e restaurar" }).click();
  await expect(page.getByText(/^Banco restaurado: \d+ registros apagados\.$/)).toBeVisible();
  await expect(dialog).toHaveCount(0);
}

test("ADMIN gera dados, é impedido pelo caixa aberto e restaura com confirmação", async ({
  context,
  page,
}) => {
  await login(context, ADMIN_EMAIL);
  await page.goto("/admin/configuracoes");
  const section = testDataSection(page);

  // Geração pela tela
  await section.getByLabel("Categorias").fill("3");
  await section.getByLabel("Produtos").fill("6");
  await section.getByLabel("Clientes").fill("2");
  await section.getByLabel("Fornecedores").fill("1");
  await section.getByRole("button", { name: "Gerar dados" }).click();
  await expect(
    page.getByText("Dados de teste gerados: 3 categorias, 6 produtos, 2 clientes, 1 fornecedor."),
  ).toBeVisible();
  await expect(history(page).first()).toContainText("Geração");
  await expect(history(page).first()).toContainText("Concluída");

  const generated = await db.product.findMany({ where: { sku: { startsWith: "TST-" } } });
  expect(generated).toHaveLength(6);
  await page.goto("/admin/produtos");
  await expect(page.getByText(generated[0].name, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Arroz 5kg").first()).toBeVisible();

  // Caixa aberto da vendedora impede a restauração
  await page.goto("/admin/configuracoes");
  await expect(section.getByRole("status")).toContainText("Caixa aberto de Vendedora Ana");
  await expect(section.getByRole("button", { name: "Restaurar banco…" })).toHaveCount(0);

  await closeCashRegister();
  await section.getByRole("button", { name: "Conferir de novo" }).click();
  await section.getByRole("button", { name: "Restaurar banco…" }).click();

  // Nome incompleto não habilita; senha errada é recusada sem apagar nada
  const dialog = page.getByRole("dialog", { name: "Restaurar banco" });
  const submit = dialog.getByRole("button", { name: "Apagar e restaurar" });
  await dialog.getByLabel(/^Digite/).fill("Loja");
  await dialog.getByLabel("Sua senha").fill(PASSWORD);
  await expect(submit).toBeDisabled();
  await dialog.getByLabel(/^Digite/).fill(TRADE_NAME);
  await dialog.getByLabel("Sua senha").fill("senha-errada");
  await submit.click();
  await expect(dialog.getByRole("alert")).toHaveText("Nome da loja ou senha incorretos.");
  await expect(dialog.getByLabel("Sua senha")).toHaveValue("");
  expect(await db.product.count()).toBe(8);

  await dialog.getByLabel("Sua senha").fill(PASSWORD);
  await submit.click();
  await expect(page.getByText(/^Banco restaurado: \d+ registros apagados\.$/)).toBeVisible();
  await expect(history(page).first()).toContainText("Restauração");
  await expect(history(page).first()).toContainText("Concluída");

  // Só usuários, configurações da loja e o histórico ficam
  expect(await db.product.count()).toBe(0);
  expect(await db.customer.count()).toBe(0);
  expect(await db.cashRegister.count()).toBe(0);
  expect(await db.user.count()).toBe(4);
  expect((await db.storeSettings.findUniqueOrThrow({ where: { id: "default" } })).tradeName).toBe(
    TRADE_NAME,
  );
  await page.goto("/admin/produtos");
  await expect(page.getByText("Arroz 5kg")).toHaveCount(0);
  await expect(page.getByText(generated[0].name, { exact: true })).toHaveCount(0);
});

for (const email of ["carla@teste.local", "ana@teste.local"]) {
  test(`${email.startsWith("carla") ? "MANAGER" : "SELLER"} não chega à seção`, async ({
    context,
    page,
  }) => {
    await login(context, email);
    await page.goto("/admin/configuracoes");
    await expect(page).toHaveURL(/\/admin\/acesso-negado$/);
    await expect(page.getByText("Dados de teste")).toHaveCount(0);
  });
}

/** Nomes dos produtos na cópia local do /pdv (IndexedDB `gestao-lojas-offline-<id>`). */
async function localProducts(page: Page, userId: string): Promise<string[]> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`gestao-lojas-offline-${id}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const rows = await new Promise<{ name: string }[]>((resolve, reject) => {
        const request = db.transaction("products").objectStore("products").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return rows.map((row) => row.name).sort();
    } finally {
      db.close();
    }
  }, userId);
}

test("PDV preparado antes da restauração recebe a carga completa sem os dados apagados", async ({
  browser,
  context,
  page,
}) => {
  await login(context, store.seller.email);
  await preparePdv(page);
  expect(await localProducts(page, store.seller.id)).toEqual(["Arroz 5kg", "Queijo minas"]);

  // A vendedora fecha o caixa; o ADMIN restaura o banco em outro navegador
  await closeCashRegister();
  const adminContext = await browser.newContext();
  await login(adminContext, ADMIN_EMAIL);
  await restoreViaUi(await adminContext.newPage());
  await adminContext.close();

  // Ao abrir de novo, o /pdv sincroniza: a época mudou, a cópia local é substituída
  await page.reload();
  await expect(page.getByRole("link", { name: "Abrir caixa" })).toBeVisible();
  await expect.poll(() => localProducts(page, store.seller.id)).toEqual([]);

  // Depois da restauração: caixa novo, produto novo e preparação de novo
  await db.cashRegister.create({
    data: {
      userId: store.seller.id,
      openUserId: store.seller.id,
      openingAmount: new Prisma.Decimal(50),
    },
  });
  await db.product.create({
    data: { name: "Feijão pós-restauração", costPrice: 5, salePrice: 8, currentStock: 3 },
  });
  await page.getByRole("button", { name: "Já abri, preparar" }).click();
  await expect(searchBox(page)).toBeVisible();
  expect(await localProducts(page, store.seller.id)).toEqual(["Feijão pós-restauração"]);
  await searchBox(page).fill("arroz");
  await expect(page.getByText("Arroz 5kg")).toHaveCount(0);
});

test("ADMIN remove pela tela só os dados gerados", async ({ context, page }) => {
  await login(context, ADMIN_EMAIL);
  await page.goto("/admin/configuracoes");
  const section = testDataSection(page);

  await section.getByLabel("Categorias").fill("2");
  await section.getByLabel("Produtos").fill("4");
  await section.getByLabel("Clientes").fill("2");
  await section.getByLabel("Fornecedores").fill("1");
  await section.getByRole("button", { name: "Gerar dados" }).click();
  await expect(page.getByText(/^Dados de teste gerados:/)).toBeVisible();
  const generatedName = (
    await db.product.findFirstOrThrow({ where: { testDataRunId: { not: null } } })
  ).name;
  await expect(
    section.getByText("Ativos agora: 2 categorias, 4 produtos, 2 clientes, 1 fornecedor."),
  ).toBeVisible();

  await section.getByRole("button", { name: "Remover dados gerados" }).click();
  await page.getByRole("button", { name: "Remover", exact: true }).click();
  await expect(
    page.getByText(
      "Removidos: 2 categorias, 4 produtos, 2 clientes, 1 fornecedor, 4 movimentações de estoque.",
    ),
  ).toBeVisible();
  await expect(history(page).first()).toContainText("Remoção dos dados gerados");
  await expect(section.getByText("Nenhum registro gerado ativo.")).toBeVisible();
  await expect(section.getByRole("button", { name: "Remover dados gerados" })).toBeDisabled();

  // Os cadastros reais continuam; os gerados saem das listas
  expect(await db.product.count({ where: { deletedAt: null } })).toBe(2);
  expect(await db.customer.count({ where: { deletedAt: null } })).toBe(1);
  await page.goto("/admin/produtos");
  await expect(page.getByText("Arroz 5kg").first()).toBeVisible();
  await expect(page.getByText(generatedName, { exact: true })).toHaveCount(0);
});
