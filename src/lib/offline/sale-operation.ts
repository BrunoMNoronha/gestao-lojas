import type { CompletedSale } from "@/components/receipt-modal";
import type {
  LocalOperation,
  LocalOperationStatus,
  LocalReceipt,
  OfflineSaleRequest,
} from "@/lib/offline/db";

// Venda do /pdv como operação da fila (issue #38, docs/OFFLINE.md seções 3 e 5). Funções puras,
// sem IndexedDB nem rede: montar o envelope do protocolo, reservar o saldo das vendas que a cópia
// local ainda não reflete e converter a operação no recibo.
//
// Precisão: o terminal trabalha com `number`. Aqui os valores viram inteiros (centavos e
// milésimos de unidade, com BigInt) e só saem como texto, no mesmo arredondamento do servidor
// (subtotal de cada item com meio para cima, em centavos). Assim o desconto e o troco do recibo
// batem com o que o servidor grava, e nada se perde no JSON.

// Sem literais BigInt: o tsconfig compila para ES2017
const ZERO = BigInt(0);
const HUNDRED = BigInt(100);
const THOUSAND = BigInt(1000);
const HALF_CENT = BigInt(500);
const MAX_MONEY_CENTS = BigInt(9_999_999_999); // 8 dígitos inteiros (MONEY_RE do servidor)
const MAX_QUANTITY_MILLI = BigInt(9_999_999_999); // 7 dígitos inteiros (QUANTITY_RE do servidor)
const INTEGER_UNITS = ["UN", "CX"];

/** Retenção das vendas já finalizadas (para reimprimir o recibo). */
export const SETTLED_RETENTION_MS = 24 * 60 * 60 * 1000;

export type PdvPaymentMethod = "MONEY" | "PIX" | "CREDIT_CARD" | "DEBIT_CARD" | "ON_ACCOUNT";

/** Venda montada no terminal, antes de virar operação. */
export interface PdvSaleDraft {
  operationId: string;
  customer: { id: string; name: string; document: string | null } | null;
  paymentMethod: PdvPaymentMethod;
  discount: number;
  amountPaid?: number;
  items: { productId: string; name: string; unit: string; quantity: number; unitPrice: number }[];
}

export type SubmitSaleResult =
  { success: true; sale: CompletedSale } | { success: false; error: string };

/** Contexto da venda: operador, aparelho e autorização da preparação. */
export interface SaleContext {
  userId: string;
  userName: string;
  deviceId: string;
  grantId: string;
  cashRegisterId: string;
  now: Date;
}

/** Venda que não pode ser gravada (o carrinho fica como está). */
export class SaleDraftError extends Error {}

const toCents = (value: number) => BigInt(Math.round(value * 100));
const toMilli = (value: number) => BigInt(Math.round(value * 1000));

function centsText(cents: bigint): string {
  const sign = cents < ZERO ? "-" : "";
  const abs = cents < ZERO ? -cents : cents;
  return `${sign}${abs / HUNDRED}.${(abs % HUNDRED).toString().padStart(2, "0")}`;
}

function milliText(milli: bigint): string {
  return `${milli / THOUSAND}.${(milli % THOUSAND).toString().padStart(3, "0")}`;
}

const textToMilli = (value: string) => toMilli(Number(value));

/** Subtotal do item em centavos: quantidade x preço com meio para cima, como o servidor. */
const lineCents = (quantity: bigint, priceCents: bigint) =>
  (quantity * priceCents + HALF_CENT) / THOUSAND;

/** Subtotal exato do item para a tela do PDV (o ponto flutuante erra centavos, ex.: 0,01 x 14,50). */
export const lineSubtotal = (quantity: number, unitPrice: number) =>
  Number(lineCents(toMilli(quantity), toCents(unitPrice))) / 100;

/**
 * Monta a operação `sale.create` e o recibo provisório. Recusa o Fiado (docs/OFFLINE.md 3.4),
 * quantidade fracionada em unidade inteira, valores fora do formato do protocolo, desconto maior
 * que o subtotal e dinheiro menor que o total (o servidor transformaria em conflito).
 */
export function buildSaleOperation(
  draft: PdvSaleDraft,
  ctx: SaleContext,
): Pick<LocalOperation, "request" | "receipt"> {
  if (draft.paymentMethod === "ON_ACCOUNT") {
    throw new SaleDraftError("O Fiado não está disponível no PDV sem internet.");
  }
  if (draft.items.length === 0) throw new SaleDraftError("A venda não tem itens.");

  let subtotal = ZERO;
  const items: LocalReceipt["items"] = [];
  const lines: OfflineSaleRequest["payload"]["items"] = [];
  for (const item of draft.items) {
    const quantity = toMilli(item.quantity);
    const price = toCents(item.unitPrice);
    if (quantity <= ZERO || quantity > MAX_QUANTITY_MILLI) {
      throw new SaleDraftError(`Quantidade inválida para "${item.name}".`);
    }
    if (INTEGER_UNITS.includes(item.unit) && quantity % THOUSAND !== ZERO) {
      throw new SaleDraftError(`"${item.name}" é vendido só em quantidades inteiras.`);
    }
    if (price < ZERO || price > MAX_MONEY_CENTS) {
      throw new SaleDraftError(`Preço inválido para "${item.name}".`);
    }
    const itemSubtotal = lineCents(quantity, price);
    subtotal += itemSubtotal;
    lines.push({
      productId: item.productId,
      quantity: milliText(quantity),
      unitPrice: centsText(price),
    });
    items.push({
      productId: item.productId,
      productName: item.name,
      unit: item.unit,
      quantity: milliText(quantity),
      unitPrice: centsText(price),
      subtotal: centsText(itemSubtotal),
    });
  }

  const discount = toCents(Math.max(0, draft.discount));
  if (discount > subtotal) {
    throw new SaleDraftError("O desconto não pode ser maior que o subtotal da venda.");
  }
  const total = subtotal - discount;
  if (total > MAX_MONEY_CENTS) throw new SaleDraftError("O total da venda excede o limite.");

  let amountPaid = total;
  if (draft.paymentMethod === "MONEY") {
    amountPaid = toCents(draft.amountPaid ?? 0);
    if (amountPaid < total) {
      throw new SaleDraftError("O valor recebido não pode ser menor que o total da venda.");
    }
    if (amountPaid > MAX_MONEY_CENTS) throw new SaleDraftError("Valor recebido inválido.");
  }

  const request: OfflineSaleRequest = {
    protocolVersion: 1,
    operationId: draft.operationId,
    kind: "sale.create",
    deviceId: ctx.deviceId,
    grantId: ctx.grantId,
    userId: ctx.userId,
    cashRegisterId: ctx.cashRegisterId,
    occurredAt: ctx.now.toISOString(),
    payload: {
      customerId: draft.customer?.id ?? null,
      paymentMethod: draft.paymentMethod,
      discount: centsText(discount),
      ...(draft.paymentMethod === "MONEY" ? { amountPaid: centsText(amountPaid) } : {}),
      items: lines,
    },
  };
  const receipt: LocalReceipt = {
    userName: ctx.userName,
    customerName: draft.customer?.name ?? "Consumidor Final",
    customerDocument: draft.customer?.document ?? null,
    total: centsText(total),
    discount: centsText(discount),
    amountPaid: centsText(amountPaid),
    change: centsText(amountPaid - total),
    items,
  };
  return { request, receipt };
}

/** Operação nova, pendente de envio. */
export function newLocalOperation(
  built: Pick<LocalOperation, "request" | "receipt">,
  createdAt: number,
): LocalOperation {
  return {
    id: built.request.operationId,
    status: "pending",
    createdAt,
    request: built.request,
    receipt: built.receipt,
    attempts: 0,
    lastAttemptAt: null,
    message: null,
    conflictReason: null,
    sale: null,
    appliedTxid: null,
    approved: false,
    settledAt: null,
  };
}

/** A baixa de estoque da venda sincronizada já chegou à cópia local? */
export function isReflected(op: LocalOperation, watermark: string | null | undefined): boolean {
  if (op.status !== "synced" || !op.appliedTxid || !watermark) return false;
  return BigInt(op.appliedTxid) < BigInt(watermark);
}

/**
 * Quantidade reservada por produto (docs/OFFLINE.md 3.2): toda venda da fila cuja baixa a cópia
 * local ainda não mostra. Inclui as em conflito e as recusadas (a mercadoria já saiu); só a
 * descartada por um gerente e a sincronizada já refletida deixam de reservar.
 */
export function reservedQuantities(
  operations: LocalOperation[],
  watermark: string | null | undefined,
): Map<string, number> {
  const milli = new Map<string, bigint>();
  for (const op of operations) {
    if (!op.request || op.status === "discarded" || isReflected(op, watermark)) continue;
    for (const item of op.request.payload.items) {
      milli.set(item.productId, (milli.get(item.productId) ?? ZERO) + textToMilli(item.quantity));
    }
  }
  return new Map([...milli].map(([id, value]) => [id, Number(value) / 1000]));
}

/** Operações finalizadas que já podem sair da fila (refletidas na cópia e fora da retenção). */
export function prunableOperationIds(
  operations: LocalOperation[],
  watermark: string | null | undefined,
  now: number,
): string[] {
  return operations
    .filter(
      (op) =>
        op.settledAt !== null &&
        now - op.settledAt >= SETTLED_RETENTION_MS &&
        (op.status === "discarded" || isReflected(op, watermark)),
    )
    .map((op) => op.id);
}

/** Código curto da venda no aparelho (recibo provisório e lista da fila). */
export const localSaleCode = (operationId: string) =>
  operationId.replace(/-/g, "").slice(0, 8).toUpperCase();

const PROVISIONAL_LABELS: Partial<Record<LocalOperationStatus, string>> = {
  pending: "PENDENTE DE SINCRONIZAÇÃO",
  syncing: "PENDENTE DE SINCRONIZAÇÃO",
  failed: "PENDENTE DE SINCRONIZAÇÃO",
  conflict: "EM CONFERÊNCIA PELO GERENTE",
  rejected: "NÃO ENVIADA - AVISE O GERENTE",
  discarded: "DESCARTADA PELO GERENTE",
};

/** Recibo da operação: provisório até sincronizar; depois, com o código oficial da venda. */
export function toCompletedSale(op: LocalOperation): CompletedSale {
  const r = op.receipt;
  const synced = op.status === "synced" && op.sale;
  return {
    id: op.sale?.id ?? op.id,
    code: synced ? op.sale!.code : null,
    localCode: localSaleCode(op.id),
    pendingLabel: synced ? undefined : PROVISIONAL_LABELS[op.status],
    total: Number(r.total),
    discount: Number(r.discount),
    paymentMethod: op.request.payload.paymentMethod,
    amountPaid: Number(r.amountPaid),
    change: Number(r.change),
    occurredAt: op.sale?.occurredAt ?? op.request.occurredAt,
    createdAt: new Date(op.createdAt).toISOString(),
    userName: r.userName,
    customerName: r.customerName,
    customerDocument: r.customerDocument,
    items: r.items.map((item, index) => ({
      id: `${op.id}-${index}`,
      productId: item.productId,
      productName: item.productName,
      unit: item.unit,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      subtotal: Number(item.subtotal),
    })),
  };
}
