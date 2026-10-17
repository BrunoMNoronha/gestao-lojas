import { test, expect, type BrowserContext } from "@playwright/test";
import { db, resetDatabase, seedStore } from "./support/db";
import { login, preparePdv, goOffline, sell, readQueue, expectQueue } from "./support/pdv";
const enabled = process.env.E2E_QUICK_LOGIN_MODE === "enabled";
let store: Awaited<ReturnType<typeof seedStore>>;
test.beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
});
async function logout(context: BrowserContext) {
  const { csrfToken } = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/signout", { form: { csrfToken }, maxRedirects: 0 });
}
test("acesso rápido troca usuário, respeita perfil e não exige senha", async ({
  page,
  context,
}) => {
  test.skip(!enabled);
  const admin = await db.user.create({
    data: {
      name: "Admin Teste",
      email: "admin@teste.local",
      password: "hash-nao-utilizado",
      role: "ADMIN",
    },
  });
  for (const user of [admin, store.manager, store.seller]) {
    await page.goto("/login?callbackUrl=https://example.com");
    await expect(page.getByLabel("Senha", { exact: true })).toHaveValue("");
    await page
      .getByRole("button", { name: `Entrar como ${user.name} (${user.email})`, exact: true })
      .click();
    await expect(page).toHaveURL(user.role === "SELLER" ? /\/pdv$/ : /\/admin$/);
    const session = await (await context.request.get("/api/auth/session")).json();
    expect(session.user.id).toBe(user.id);
    expect(session.user.role).toBe(user.role);
    if (user.role === "SELLER") {
      await page.goto("/admin/usuarios");
      await expect(page).toHaveURL(/acesso-negado/);
    }
    // Desmonta a página antes do logout via API para não renovar cookies em requisições em voo.
    await page.goto("about:blank");
    await logout(context);
    expect((await (await context.request.get("/api/auth/session")).json())?.user).toBeUndefined();
  }
});
test("usuário desativado após listar não entra; hash não chega à página", async ({
  page,
  context,
}) => {
  test.skip(!enabled);
  await page.goto("/login");
  expect(await page.content()).not.toContain(store.seller.password);
  await db.user.update({ where: { id: store.seller.id }, data: { active: false } });
  await page
    .getByRole("button", {
      name: `Entrar como ${store.seller.name} (${store.seller.email})`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Não foi possível entrar" }),
  ).toContainText("Não foi possível entrar");
  expect((await (await context.request.get("/api/auth/session")).json())?.user).toBeUndefined();
});
test("produção oculta lista e recusa callback direto mesmo com flag ligada", async ({
  page,
  context,
}) => {
  test.skip(process.env.E2E_QUICK_LOGIN_MODE !== "production");
  await page.goto("/login");
  await expect(page.getByText("Acesso rápido — ambiente de testes")).toHaveCount(0);
  expect(await page.content()).not.toContain(store.seller.email);
  const { csrfToken } = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/dev-quick-login", {
    form: {
      csrfToken,
      userId: store.seller.id,
      role: "ADMIN",
      APP_ENV: "test",
      ENABLE_DEV_QUICK_LOGIN: "true",
    },
    maxRedirects: 0,
  });
  expect((await (await context.request.get("/api/auth/session")).json())?.user).toBeUndefined();
  await login(context, store.seller.email);
});

test("callback exige CSRF e ignora perfil adulterado", async ({ context }) => {
  test.skip(!enabled);
  await context.request.post("/api/auth/callback/dev-quick-login", {
    form: { userId: store.seller.id },
    maxRedirects: 0,
  });
  expect((await (await context.request.get("/api/auth/session")).json())?.user).toBeUndefined();
  const { csrfToken } = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/dev-quick-login", {
    form: { csrfToken, userId: store.seller.id, role: "ADMIN" },
    maxRedirects: 0,
  });
  const session = await (await context.request.get("/api/auth/session")).json();
  expect(session.user.id).toBe(store.seller.id);
  expect(session.user.role).toBe("SELLER");
});

test("troca pelo acesso rápido preserva e isola a fila offline do operador anterior", async ({
  context,
  page,
}) => {
  test.skip(!enabled);
  const quick = async (user: typeof store.seller) => {
    await page.goto("/login");
    await page
      .getByRole("button", { name: `Entrar como ${user.name} (${user.email})`, exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\/pdv$/);
  };
  await quick(store.seller);
  await preparePdv(page);
  await goOffline(context, page);
  await sell(page, [{ code: "ARZ", quantity: 1 }]);
  await page.getByRole("button", { name: "Encerrar neste aparelho" }).click();
  await page.getByRole("button", { name: "Encerrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "PDV indisponível sem conexão" })).toBeVisible();
  await logout(context);
  await context.setOffline(false);
  await expect(page).toHaveURL(/\/login/);
  await quick(store.otherSeller);
  await page.goto("/pdv");
  await expect(page.getByRole("button", { name: "Preparar este aparelho" })).toBeVisible();
  await expect(page.getByRole("button", { name: /outros operadores|venda a enviar/ })).toHaveCount(
    0,
  );
  expect((await readQueue(page, store.seller.id)).map((o) => o.status)).toEqual(["pending"]);
  expect(await db.sale.count()).toBe(0);
  await page.goto("about:blank");
  await logout(context);
  await quick(store.seller);
  await page.goto("/pdv");
  await expectQueue(page, store.seller.id, ["synced"]);
  expect((await db.sale.findFirstOrThrow()).userId).toBe(store.seller.id);
});
