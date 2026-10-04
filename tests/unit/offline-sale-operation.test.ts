import { describe, expect, it } from "vitest";
import type { LocalOperation } from "@/lib/offline/db";
import {
  buildSaleOperation,
  newLocalOperation,
  prunableOperationIds,
  reservedQuantities,
  SaleDraftError,
  SETTLED_RETENTION_MS,
  toCompletedSale,
  type PdvSaleDraft,
  type SaleContext,
} from "@/lib/offline/sale-operation";

// Venda do /pdv como operação da fila (issue #38): envelope do protocolo com decimais exatos,
// saldo reservado e recibo provisório.

const ctx: SaleContext = {
  userId: "user-1",
  userName: "Operador",
  deviceId: "11111111-1111-4111-8111-111111111111",
  grantId: "22222222-2222-4222-8222-222222222222",
  cashRegisterId: "cash-1",
  now: new Date("2026-10-04T15:00:00.000Z"),
};

function draft(overrides: Partial<PdvSaleDraft> = {}): PdvSaleDraft {
  return {
    operationId: "33333333-3333-4333-8333-333333333333",
    customer: null,
    paymentMethod: "PIX",
    discount: 0,
    items: [{ productId: "p1", name: "Arroz", unit: "UN", quantity: 2, unitPrice: 19.99 }],
    ...overrides,
  };
}

function operation(
  id: string,
  overrides: Partial<LocalOperation> = {},
  items: PdvSaleDraft["items"] = [
    { productId: "p1", name: "Arroz", unit: "UN", quantity: 1, unitPrice: 10 },
  ],
): LocalOperation {
  const op = newLocalOperation(buildSaleOperation(draft({ operationId: id, items }), ctx), 1_000);
  return { ...op, ...overrides };
}

describe("buildSaleOperation", () => {
  it("monta o envelope v1 com decimais como texto e o caixa da autorização", () => {
    const { request, receipt } = buildSaleOperation(
      draft({
        paymentMethod: "MONEY",
        amountPaid: 50,
        discount: 0.98,
        customer: { id: "c1", name: "Maria", document: "***.456.789-**" },
      }),
      ctx,
    );
    expect(request).toEqual({
      protocolVersion: 1,
      operationId: "33333333-3333-4333-8333-333333333333",
      kind: "sale.create",
      deviceId: ctx.deviceId,
      grantId: ctx.grantId,
      userId: "user-1",
      cashRegisterId: "cash-1",
      occurredAt: "2026-10-04T15:00:00.000Z",
      payload: {
        customerId: "c1",
        paymentMethod: "MONEY",
        discount: "0.98",
        amountPaid: "50.00",
        items: [{ productId: "p1", quantity: "2.000", unitPrice: "19.99" }],
      },
    });
    expect(receipt).toMatchObject({
      customerName: "Maria",
      total: "39.00",
      discount: "0.98",
      amountPaid: "50.00",
      change: "11.00",
    });
  });

  it("arredonda o subtotal de cada item como o servidor (meio para cima, em centavos)", () => {
    // 0,01 kg x R$ 14,50 = 0,145: em ponto flutuante (Math.round(q * p * 100)) sairia 0,14
    const { receipt } = buildSaleOperation(
      draft({
        items: [
          { productId: "p1", name: "Feijão", unit: "KG", quantity: 0.01, unitPrice: 14.5 },
          { productId: "p2", name: "Queijo", unit: "KG", quantity: 0.333, unitPrice: 45.9 },
        ],
      }),
      ctx,
    );
    expect(receipt.items.map((item) => item.subtotal)).toEqual(["0.15", "15.28"]);
    expect(receipt.items[1].quantity).toBe("0.333");
    expect(receipt.total).toBe("15.43");
  });

  it("não manda o valor recebido fora do dinheiro", () => {
    const { request, receipt } = buildSaleOperation(draft({ amountPaid: 100 }), ctx);
    expect(request.payload).not.toHaveProperty("amountPaid");
    expect(receipt.amountPaid).toBe("39.98");
    expect(receipt.change).toBe("0.00");
  });

  it.each([
    ["Fiado", draft({ paymentMethod: "ON_ACCOUNT" }), /Fiado/],
    ["desconto maior que o subtotal", draft({ discount: 40 }), /desconto/],
    [
      "dinheiro menor que o total",
      draft({ paymentMethod: "MONEY", amountPaid: 39.97 }),
      /recebido/,
    ],
    [
      "quantidade fracionada em unidade inteira",
      draft({
        items: [{ productId: "p1", name: "Arroz", unit: "UN", quantity: 1.5, unitPrice: 1 }],
      }),
      /inteiras/,
    ],
    ["venda sem itens", draft({ items: [] }), /itens/],
  ])("recusa %s", (_, input, message) => {
    expect(() => buildSaleOperation(input, ctx)).toThrow(SaleDraftError);
    expect(() => buildSaleOperation(input, ctx)).toThrow(message);
  });
});

describe("reservedQuantities", () => {
  const kg = (quantity: number) => [
    { productId: "p2", name: "Queijo", unit: "KG", quantity, unitPrice: 10 },
  ];

  it("reserva as vendas que a cópia ainda não mostra, sem erro de ponto flutuante", () => {
    const ops = [
      operation("a", {}, kg(0.1)),
      operation("b", { status: "conflict" }, kg(0.2)),
      operation("c", { status: "rejected" }),
      operation("d", { status: "failed" }),
    ];
    const reserved = reservedQuantities(ops, "100");
    expect(reserved.get("p2")).toBe(0.3);
    expect(reserved.get("p1")).toBe(2);
  });

  it("libera a sincronizada quando a cópia já reflete a transação dela, e a descartada", () => {
    const ops = [
      operation("refletida", { status: "synced", appliedTxid: "99" }),
      operation("ainda-nao", { status: "synced", appliedTxid: "100" }),
      operation("sem-limite", { status: "synced", appliedTxid: "5" }),
      operation("descartada", { status: "discarded" }),
    ];
    expect(reservedQuantities(ops.slice(0, 2), "100").get("p1")).toBe(1);
    expect(reservedQuantities(ops.slice(2, 3), null).get("p1")).toBe(1);
    expect(reservedQuantities(ops.slice(3), "100").size).toBe(0);
  });
});

describe("prunableOperationIds", () => {
  it("remove só as finalizadas, refletidas e fora da retenção", () => {
    const now = 10 * SETTLED_RETENTION_MS;
    const old = now - SETTLED_RETENTION_MS;
    const ops = [
      operation("velha", { status: "synced", appliedTxid: "1", settledAt: old }),
      operation("recente", { status: "synced", appliedTxid: "1", settledAt: now - 1000 }),
      operation("nao-refletida", { status: "synced", appliedTxid: "500", settledAt: old }),
      operation("descartada", { status: "discarded", settledAt: old }),
      operation("conflito", { status: "conflict", settledAt: null }),
    ];
    expect(prunableOperationIds(ops, "100", now)).toEqual(["velha", "descartada"]);
  });
});

describe("toCompletedSale", () => {
  it("recibo provisório com o código local; depois, com o código oficial", () => {
    const op = operation("44444444-4444-4444-8444-444444444444");
    const provisional = toCompletedSale(op);
    expect(provisional.code).toBeNull();
    expect(provisional.localCode).toBe("44444444");
    expect(provisional.pendingLabel).toBe("PENDENTE DE SINCRONIZAÇÃO");
    expect(provisional.total).toBe(10);

    const synced = toCompletedSale({
      ...op,
      status: "synced",
      sale: { id: "sale-1", code: 42, occurredAt: "2026-10-04T14:59:00.000Z" },
    });
    expect(synced).toMatchObject({ id: "sale-1", code: 42, localCode: "44444444" });
    expect(synced.pendingLabel).toBeUndefined();
    expect(synced.occurredAt).toBe("2026-10-04T14:59:00.000Z");
  });
});
