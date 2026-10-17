import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "./fixtures";
import {
  guardLoginAttempt,
  LOGIN_ATTEMPT_RETENTION_MS,
  MAX_LOGIN_FAILURES_PER_EMAIL,
  MAX_LOGIN_FAILURES_PER_IP,
} from "@/lib/login-rate-limit";

// Limite de tentativas de login com o Postgres de verdade: travas consultivas e consultas do
// Prisma. As regras em detalhe estão em tests/unit/login-rate-limit.test.ts.

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const fail = async () => null;

describe("limite de tentativas de login (Postgres)", () => {
  it("tentativas em paralelo do mesmo e-mail não passam do limite", async () => {
    let checked = 0;
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        guardLoginAttempt({ email: "Dona@Loja.com", ip: `10.0.0.${i}` }, async () => {
          checked++;
          return null;
        }),
      ),
    );

    expect(checked).toBe(MAX_LOGIN_FAILURES_PER_EMAIL);
    expect(results.filter((r) => r.status === "limited")).toHaveLength(
      12 - MAX_LOGIN_FAILURES_PER_EMAIL,
    );
    expect(await prisma.loginAttempt.count({ where: { email: "dona@loja.com" } })).toBe(
      MAX_LOGIN_FAILURES_PER_EMAIL,
    );
  });

  it("tentativas em paralelo do mesmo IP não passam do limite", async () => {
    const results = await Promise.all(
      Array.from({ length: MAX_LOGIN_FAILURES_PER_IP + 5 }, (_, i) =>
        guardLoginAttempt({ email: `teste${i}@loja.com`, ip: "200.1.1.1" }, fail),
      ),
    );
    expect(results.filter((r) => r.status === "done")).toHaveLength(MAX_LOGIN_FAILURES_PER_IP);
  });

  it("login certo vira sucesso, zera o e-mail e apaga registros antigos", async () => {
    const old = new Date(Date.now() - LOGIN_ATTEMPT_RETENTION_MS - 60_000);
    await prisma.loginAttempt.create({ data: { email: "antigo@loja.com", createdAt: old } });
    for (let i = 0; i < MAX_LOGIN_FAILURES_PER_EMAIL - 1; i++) {
      await guardLoginAttempt({ email: "dona@loja.com", ip: null }, fail);
    }

    const user = { id: "u1" };
    const ok = await guardLoginAttempt({ email: "dona@loja.com", ip: null }, async () => user, {
      now: new Date(Date.now() + 1000),
    });
    expect(ok).toEqual({ status: "done", user });

    const next = await guardLoginAttempt({ email: "dona@loja.com", ip: null }, fail, {
      now: new Date(Date.now() + 2000),
    });
    expect(next.status).toBe("done");
    expect(await prisma.loginAttempt.count({ where: { success: true } })).toBe(1);
    expect(await prisma.loginAttempt.count({ where: { email: "antigo@loja.com" } })).toBe(0);
  });
});
