import { describe, expect, it } from "vitest";
import { runtimeDatabaseUrl } from "@/lib/database-url";
describe("pool de execução", () => {
  it("preserva conexões diretas, locais e configurações explícitas", () => {
    expect(runtimeDatabaseUrl(undefined)).toBeUndefined();
    const local = "postgresql://user:password@127.0.0.1:5432/test";
    expect(runtimeDatabaseUrl(local)).toBe(local);
    const direct = "postgresql://user:password@ep-example.neon.tech/test?sslmode=require";
    expect(runtimeDatabaseUrl(direct)).toBe(direct);
    const pooled = new URL(
      runtimeDatabaseUrl(
        "postgresql://user:password@ep-example-pooler.neon.tech/test?connection_limit=2&sslmode=require",
      )!,
    );
    expect(pooled.searchParams.get("connection_limit")).toBe("2");
    expect(pooled.searchParams.get("pool_timeout")).toBe("10");
    expect(pooled.searchParams.get("pgbouncer")).toBe("true");
    expect(pooled.searchParams.get("sslmode")).toBe("require");
  });
});
