import { beforeEach, afterEach, afterAll, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createUser, resetDatabase } from "./fixtures";
import { getQuickLoginOptions, authorizeQuickLogin } from "@/lib/quick-login";
import { authConfig } from "@/auth.config";
import type { JWT } from "next-auth/jwt";

beforeEach(async () => {
  await resetDatabase();
  const url = new URL(process.env.DATABASE_URL!);
  vi.stubEnv("ENABLE_DEV_QUICK_LOGIN", "true");
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("DEV_QUICK_LOGIN_DATABASE", `${url.host}${url.pathname}`);
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("VERCEL_TARGET_ENV", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => prisma.$disconnect());
it("lista apenas ativos e não expõe hash; perfil vem do banco", async () => {
  const u = await createUser();
  await prisma.user.create({
    data: { name: "Inativo", email: "off@test.local", password: "secret", active: false },
  });
  expect(await getQuickLoginOptions()).toEqual({
    enabled: true,
    users: [{ id: u.id, name: u.name, email: u.email, role: u.role }],
  });
  for (const role of ["ADMIN", "MANAGER", "SELLER"] as const) {
    await prisma.user.update({ where: { id: u.id }, data: { role } });
    const login = await authorizeQuickLogin(u.id);
    expect(login?.role).toBe(role);
    expect(login).not.toHaveProperty("password");
  }
});
it("recusa usuário desativado/removido entre lista e clique e entradas inválidas", async () => {
  const u = await createUser();
  await getQuickLoginOptions();
  await prisma.user.update({ where: { id: u.id }, data: { active: false } });
  expect(await authorizeQuickLogin(u.id)).toBeNull();
  await prisma.user.delete({ where: { id: u.id } });
  for (const id of [u.id, undefined, {}, "", "x".repeat(129)])
    expect(await authorizeQuickLogin(id)).toBeNull();
});
it("produção nega lista e login antes de consultar o banco, mesmo com flag ligada", async () => {
  vi.stubEnv("VERCEL_ENV", "production");
  const list = vi.spyOn(prisma.user, "findMany");
  const login = vi.spyOn(prisma.user, "findFirst");
  expect(await getQuickLoginOptions()).toEqual({ enabled: false });
  expect(await authorizeQuickLogin("qualquer-id")).toBeNull();
  expect(list).not.toHaveBeenCalled();
  expect(login).not.toHaveBeenCalled();
});
it("lista vazia e banco indisponível não quebram o formulário nem criam usuário", async () => {
  expect(await getQuickLoginOptions()).toEqual({ enabled: true, users: [] });
  vi.spyOn(prisma.user, "findMany").mockRejectedValue(new Error("detalhe privado"));
  const result = await getQuickLoginOptions();
  expect(result.enabled && result.error).toBeTruthy();
  expect(JSON.stringify(result)).not.toContain("detalhe privado");
  expect(await prisma.user.count()).toBe(0);
});
it("JWT identifica origem, invalida no desligamento/produção e mantém login convencional", async () => {
  const user = await createUser();
  const jwt = authConfig.callbacks.jwt;
  type Args = Parameters<typeof jwt>[0];
  const run = (token: JWT, extra = {}) => jwt({ token, ...extra } as Args);
  const token = await run({}, { user, account: { provider: "dev-quick-login" } });
  expect(token?.quickLoginContext).toBeTruthy();
  expect(await run(token!)).toEqual(token);
  vi.stubEnv("ENABLE_DEV_QUICK_LOGIN", "false");
  expect(await run(token!)).toBeNull();
  vi.stubEnv("ENABLE_DEV_QUICK_LOGIN", "true");
  vi.stubEnv("VERCEL_ENV", "production");
  expect(await run(token!)).toBeNull();
  const normal = await run(token!, { user, account: { provider: "credentials" } });
  expect(normal?.id).toBe(user.id);
  expect(normal).not.toHaveProperty("quickLoginContext");
});
