import { describe, expect, it } from "vitest";

// Cifra compartilhada do servidor (issue #113): ida e volta, token adulterado e rótulos separados
process.env.AUTH_SECRET = "segredo-de-teste-da-cifra";
const { openText, sealText } = await import("@/lib/secret-box");

const BOX = { info: "teste-v1", version: 1 };

describe("secret-box", () => {
  it("decifra o que cifrou, com IV novo a cada vez", () => {
    const a = sealText("sk-ant-segredo", BOX);
    const b = sealText("sk-ant-segredo", BOX);
    expect(a).not.toBe(b);
    expect(a).not.toContain("segredo");
    expect(openText(a, BOX)).toBe("sk-ant-segredo");
  });

  it("recusa token adulterado, de outro rótulo ou de outra versão", () => {
    const token = sealText("valor", BOX);
    const bytes = Buffer.from(token, "base64url");
    bytes[bytes.length - 1] ^= 1;
    expect(openText(bytes.toString("base64url"), BOX)).toBeNull();
    expect(openText(token, { info: "outro-uso-v1", version: 1 })).toBeNull();
    expect(openText(token, { info: "teste-v1", version: 2 })).toBeNull();
    expect(openText("curto", BOX)).toBeNull();
  });

  it("não abre depois de trocar o AUTH_SECRET", () => {
    const token = sealText("valor", BOX);
    process.env.AUTH_SECRET = "outro-segredo";
    expect(openText(token, BOX)).toBeNull();
    process.env.AUTH_SECRET = "segredo-de-teste-da-cifra";
    expect(openText(token, BOX)).toBe("valor");
  });
});
