import { describe, expect, it, vi } from "vitest";

// Formato da chave da API Anthropic (issue #113); a leitura do banco fica nos testes de integração
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const { apiKeyHint, validateApiKeyFormat } = await import("@/lib/ai-key");

const KEY = `sk-ant-api03-${"a".repeat(40)}abcd`;

describe("chave da API dos insights", () => {
  it("aceita chave sk-ant- e tira espaços das pontas", () => {
    expect(validateApiKeyFormat(`  ${KEY}\n`)).toEqual({ ok: true, value: KEY });
  });

  it.each([undefined, "", "   ", "sk-proj-123456789012345678901234", "sk-ant-curta", `${KEY} x`])(
    "recusa %j",
    (value) => {
      expect(validateApiKeyFormat(value).ok).toBe(false);
    },
  );

  it("mostra só os 4 últimos caracteres", () => {
    expect(apiKeyHint(KEY)).toBe("abcd");
  });
});
