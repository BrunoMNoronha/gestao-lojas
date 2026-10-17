import { describe, expect, it, vi } from "vitest";
import { decodeOrderLink, encodeOrderLink, type OrderLinkData } from "@/lib/catalog-shared";

// buildMessage não toca no banco; o mock evita abrir o Prisma no teste unitário
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const { buildMessage } = await import("@/lib/catalog-order");

const KEY = "0f8fad5b-d9cb-469f-a165-70867728950e";
const link: OrderLinkData = {
  key: KEY,
  items: [
    { productId: "cm123abc", quantity: 2 },
    { productId: "cm456def", quantity: 0.75 },
  ],
};

describe("link do pedido (issue #81)", () => {
  it("ida e volta preserva chave e itens, em base64url", () => {
    const token = encodeOrderLink(link);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeOrderLink(token)).toEqual(link);
  });

  it("não leva dados pessoais, só chave e itens", () => {
    const json = atob(encodeOrderLink(link).replace(/-/g, "+").replace(/_/g, "/"));
    expect(Object.keys(JSON.parse(json)).sort()).toEqual(["i", "k", "v"]);
  });

  it("recusa token adulterado, malformado ou fora dos limites", () => {
    const encode = (value: unknown) =>
      btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const valid = { v: 1, k: KEY, i: [["cm123abc", 2]] };

    expect(decodeOrderLink(undefined)).toBeNull();
    expect(decodeOrderLink("")).toBeNull();
    expect(decodeOrderLink("não é base64")).toBeNull();
    expect(decodeOrderLink(encode("texto"))).toBeNull();
    expect(decodeOrderLink(encode({ ...valid, v: 2 }))).toBeNull();
    expect(decodeOrderLink(encode({ ...valid, k: "123" }))).toBeNull();
    expect(decodeOrderLink(encode({ ...valid, i: [] }))).toBeNull();
    expect(
      decodeOrderLink(
        encode({
          ...valid,
          i: [
            ["a", 1],
            ["a", 2],
          ],
        }),
      ),
    ).toBeNull();
    expect(decodeOrderLink(encode({ ...valid, i: [["cm123abc", 0]] }))).toBeNull();
    expect(decodeOrderLink(encode({ ...valid, i: [["cm123abc", 1.2345]] }))).toBeNull();
    expect(decodeOrderLink(encode({ ...valid, i: [["id com espaço", 1]] }))).toBeNull();
    expect(
      decodeOrderLink(encode({ ...valid, i: Array.from({ length: 101 }, (_, n) => [`p${n}`, 1]) })),
    ).toBeNull();
    expect(decodeOrderLink("a".repeat(9000))).toBeNull();
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
  const customer = { name: "Maria", fulfillment: "PICKUP" as const };

  it("inclui o link sem afirmar registro, envio ou leitura", () => {
    const message = buildMessage(
      { name: "Loja" },
      items,
      20,
      customer,
      "https://loja.exemplo/catalogo/pedido?p=abc",
    );
    expect(message).toContain("*Link do pedido:* https://loja.exemplo/catalogo/pedido?p=abc");
    expect(message).not.toMatch(/registrad|enviad|lid[oa]\b|Pedido nº/i);
  });

  it("sem link mantém a mensagem da prévia", () => {
    expect(buildMessage({ name: "Loja" }, items, 20, customer)).not.toContain("Link do pedido");
  });
});
