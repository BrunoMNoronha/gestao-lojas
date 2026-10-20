import { createCipheriv, hkdfSync, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { OrderLinkData } from "@/lib/order-link";

// buildMessage não toca no banco; o mock evita abrir o Prisma no teste unitário
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const SECRET = "segredo-de-teste-do-link-do-pedido";
process.env.AUTH_SECRET = SECRET;
const { decodeOrderLink, encodeOrderLink } = await import("@/lib/order-link");
const { buildMessage } = await import("@/lib/catalog-order");

const KEY = "0f8fad5b-d9cb-469f-a165-70867728950e";
const link: OrderLinkData = {
  key: KEY,
  items: [
    { productId: "cm123abc", quantity: 2 },
    { productId: "cm456def", quantity: 0.75 },
  ],
  contact: { name: "Maria Souza", phone: "11999998888" },
};

// Monta um token com o mesmo formato, para testar o que o decode recusa depois de descriptografar
function sealed(payload: unknown, secret = SECRET, version = 2): string {
  const key = Buffer.from(hkdfSync("sha256", secret, "gestao-lojas", "catalog-order-link-v2", 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([version]), iv, cipher.getAuthTag(), data]).toString(
    "base64url",
  );
}

const valid = { k: KEY, i: [["cm123abc", 2]], c: { n: "Maria Souza", p: "11999998888" } };

beforeAll(() => {
  process.env.AUTH_SECRET = SECRET;
});

describe("link do pedido criptografado (issue #81)", () => {
  it("ida e volta preserva chave, itens e contato, em base64url", () => {
    const token = encodeOrderLink(link);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeOrderLink(token)).toEqual(link);
  });

  it("não expõe nome, telefone nem ids no token", () => {
    const token = encodeOrderLink(link);
    const raw = Buffer.from(token, "base64url").toString("latin1");
    for (const text of ["Maria", "11999998888", "cm123abc", KEY]) {
      expect(token).not.toContain(text);
      expect(raw).not.toContain(text);
    }
    // IV aleatório: o mesmo pedido gera tokens diferentes
    expect(encodeOrderLink(link)).not.toBe(token);
  });

  it("recusa token adulterado, de outra chave ou de outra versão", () => {
    const token = encodeOrderLink(link);
    const bytes = Buffer.from(token, "base64url");
    bytes[bytes.length - 1] ^= 1;
    expect(decodeOrderLink(bytes.toString("base64url"))).toBeNull();
    expect(decodeOrderLink(sealed(valid, "outro-segredo"))).toBeNull();
    expect(decodeOrderLink(sealed(valid, SECRET, 1))).toBeNull();
    expect(decodeOrderLink(sealed(valid))).not.toBeNull();
  });

  it("recusa token malformado ou fora dos limites", () => {
    expect(decodeOrderLink(undefined)).toBeNull();
    expect(decodeOrderLink("")).toBeNull();
    expect(decodeOrderLink("não é base64")).toBeNull();
    expect(decodeOrderLink("a".repeat(13000))).toBeNull();
    expect(decodeOrderLink(sealed({ ...valid, k: "123" }))).toBeNull();
    expect(decodeOrderLink(sealed({ ...valid, i: [] }))).toBeNull();
    expect(
      decodeOrderLink(
        sealed({
          ...valid,
          i: [
            ["a", 1],
            ["a", 2],
          ],
        }),
      ),
    ).toBeNull();
    expect(decodeOrderLink(sealed({ ...valid, i: [["cm123abc", 0]] }))).toBeNull();
    expect(decodeOrderLink(sealed({ ...valid, i: [["cm123abc", 1.2345]] }))).toBeNull();
    expect(decodeOrderLink(sealed({ ...valid, i: [["id com espaço", 1]] }))).toBeNull();
    expect(
      decodeOrderLink(sealed({ ...valid, i: Array.from({ length: 101 }, (_, n) => [`p${n}`, 1]) })),
    ).toBeNull();
  });

  it("exige nome e telefone válidos", () => {
    expect(decodeOrderLink(sealed({ ...valid, c: undefined }))).toBeNull();
    expect(decodeOrderLink(sealed({ ...valid, c: { n: "M", p: "11999998888" } }))).toBeNull();
    expect(decodeOrderLink(sealed({ ...valid, c: { n: "Maria", p: "999" } }))).toBeNull();
    expect(decodeOrderLink(sealed({ ...valid, c: { n: "Maria", p: "" } }))).toBeNull();
    expect(
      decodeOrderLink(sealed({ ...valid, c: { n: "Maria", p: "(11) 3333-4444" } }))?.contact,
    ).toEqual({ name: "Maria", phone: "1133334444" });
  });
});

describe("mensagem do WhatsApp com o link do pedido", () => {
  const items = [
    {
      productId: "p1",
      name: "Arroz 5kg",
      unit: "UN" as const,
      quantity: 2,
      price: 10,
      subtotal: 20,
    },
  ];
  const customer = { name: "Maria", phone: "11999998888", fulfillment: "PICKUP" as const };

  it("inclui telefone e link sem afirmar registro, envio ou leitura", () => {
    const message = buildMessage(
      { name: "Loja" },
      items,
      20,
      customer,
      "https://loja.exemplo/catalogo/pedido?p=abc",
    );
    expect(message).toContain("*Telefone:* (11) 99999-8888");
    expect(message).toContain("*Link do pedido:* https://loja.exemplo/catalogo/pedido?p=abc");
    expect(message).not.toMatch(/registrad|enviad|lid[oa]\b|Pedido nº/i);
  });

  it("sem link mantém a mensagem da prévia", () => {
    expect(buildMessage({ name: "Loja" }, items, 20, customer)).not.toContain("Link do pedido");
  });
});
