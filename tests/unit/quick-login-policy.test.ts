import { describe, it, expect } from "vitest";
import { quickLoginContext } from "@/lib/quick-login-policy";
const enabled = {
  ENABLE_DEV_QUICK_LOGIN: "true",
  APP_ENV: "local",
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://u:p@localhost:5433/store",
  DEV_QUICK_LOGIN_DATABASE: "localhost:5433/store",
};
describe("política de acesso rápido", () => {
  it.each(["development", "test", "production"])(
    "permite build %s em ambiente local explicitamente habilitado",
    (NODE_ENV) => expect(quickLoginContext({ ...enabled, NODE_ENV })).toBeTruthy(),
  );
  it.each([
    { ENABLE_DEV_QUICK_LOGIN: undefined },
    { ENABLE_DEV_QUICK_LOGIN: "false" },
    { APP_ENV: undefined },
    { APP_ENV: "production" },
    { APP_ENV: "unknown" },
    { NODE_ENV: undefined },
    { VERCEL_ENV: "production" },
    { VERCEL_TARGET_ENV: "production" },
    { VERCEL_ENV: "preview" },
    { VERCEL_ENV: "unknown" },
    { DEV_QUICK_LOGIN_DATABASE: "another/database" },
    { DATABASE_URL: "invalid" },
    {
      DATABASE_URL: "postgresql://u:p@cloud.example/store",
      DEV_QUICK_LOGIN_DATABASE: "cloud.example/store",
    },
  ])("nega configuração ausente/contraditória %j", (overrides) =>
    expect(quickLoginContext({ ...enabled, ...overrides })).toBeNull(),
  );
  it("permite preview explícito com banco isolado confirmado e nega sinal de produção", () => {
    const env = {
      ...enabled,
      NODE_ENV: "production",
      APP_ENV: "preview",
      VERCEL_ENV: "preview",
      DATABASE_URL: "postgresql://u:p@preview.example/store",
      DEV_QUICK_LOGIN_DATABASE: "preview.example/store",
    };
    expect(quickLoginContext(env)).toBeTruthy();
    expect(quickLoginContext({ ...env, VERCEL_TARGET_ENV: "production" })).toBeNull();
  });
});
