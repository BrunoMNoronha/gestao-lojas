import {
  CashRegisterStatus,
  MovementType,
  PaymentMethod,
  Prisma,
  ReconciliationIssueType,
  SyncConflictReason,
  SyncOperationKind,
  SyncOperationStatus,
  Unit,
  type CashRegister,
  type OfflineDevice,
  type OfflineGrant,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { lockCashRegisterById } from "@/lib/cash-register";
import { getOnAccountSettings } from "@/lib/on-account";
import { storeDueDate } from "@/lib/store-time";
import { hashPayload, isDuplicateOperation, parseOperationId } from "@/lib/sync-operation";

// Sincronização das vendas feitas offline (issue #38, docs/OFFLINE.md seções 3 a 5). Usado apenas
// no servidor, pelo Route Handler POST /api/offline/operations (que autoriza com "pdv.use") e
// pelas Server Actions de conciliação (que autorizam com "offline.reconcile").
//
// Uma venda offline já aconteceu: aqui ela nunca é recalculada nem descartada em silêncio.
// - Aplicada: venda, itens, estoque (pode ficar negativo), caixa original e pendências de
//   conciliação numa única transação, junto com a SyncOperation (chave de idempotência).
// - Conflito: a SyncOperation é gravada com a situação CONFLICT, o payload e o motivo, sem
//   nenhum efeito; um gerente aprova (aplica com a autoria e o caixa originais) ou descarta.
// - Mesma chave e mesmo payload devolvem o resultado gravado; payload diferente é recusado.

/** Versão do protocolo de envio (docs/OFFLINE.md seção 5). */
export const OFFLINE_OPERATIONS_PROTOCOL_VERSION = 1;
export const MAX_OPERATIONS_PER_BATCH = 50;
const MAX_ITEMS_PER_SALE = 500;
const MAX_ID_LENGTH = 64;
// Versão do payload canônico usado no hash (muda se o formato mudar)
const OFFLINE_SALE_PAYLOAD_VERSION = 1;

/**
 * Tolerância antes da emissão da autorização ao conferir o preço praticado. A carga completa da
 * preparação só enxerga transações já confirmadas: uma alteração de preço que começou pouco antes
 * da emissão (o histórico grava o início da transação) e confirmou depois da leitura deixa no
 * aparelho o preço anterior, que já não era o vigente na emissão. 15 minutos cobrem essa borda com
 * folga sem aceitar preços de turnos anteriores.
 */
export const PRICE_WINDOW_TOLERANCE_MS = 15 * 60 * 1000;

/** Telas afetadas por uma venda sincronizada ou aprovada (revalidadas pelo chamador). */
export const OFFLINE_SALE_PATHS = [
  "/admin",
  "/admin/pdv",
  "/admin/produtos",
  "/admin/estoque",
  "/admin/caixa",
  "/admin/contas-a-receber",
  "/admin/relatorios/vendas",
];

const INTEGER_UNITS: Unit[] = [Unit.UN, Unit.CX];
const MONEY_RE = /^\d{1,8}(\.\d{1,2})?$/;
const QUANTITY_RE = /^\d{1,7}(\.\d{1,3})?$/;

// ---------------------------------------------------------------------------------------------
// Resultado por operação (resposta do lote)

export interface AppliedSale {
  id: string;
  code: number;
  occurredAt: string;
}

export type OfflineOperationResult =
  | {
      operationId: string;
      status: "applied" | "approved";
      replayed: boolean;
      sale: AppliedSale;
      // Id da transação que gravou a venda (texto: bigint)
      appliedTxid: string;
    }
  | {
      operationId: string;
      status: "conflict";
      replayed: boolean;
      reason: SyncConflictReason;
      message: string;
    }
  | { operationId: string; status: "discarded"; replayed: true; message: string }
  | {
      operationId: string | null;
      // invalid: formato inválido; protocol_error: mesma chave com outros dados;
      // forbidden: operação de outro operador; retry: falha temporária, nada foi gravado
      status: "invalid" | "protocol_error" | "forbidden" | "retry";
      message: string;
    };

type RejectionStatus = "invalid" | "protocol_error" | "forbidden";

/** Operação recusada sem gravar nada (formato, chave reaproveitada ou autoria). */
class OperationRejected extends Error {
  constructor(
    readonly status: RejectionStatus,
    message: string,
  ) {
    super(message);
  }
}

/** Regra de negócio que impede aplicar a venda: vira conflito (ou erro na aprovação). */
class SaleConflict extends Error {
  constructor(
    readonly reason: SyncConflictReason,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------------
// Leitura e normalização da operação

interface OfflineSaleLine {
  productId: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
}

/** Operação normalizada; `canonical` é o que entra no hash e fica guardado em SyncOperation.payload. */
interface ParsedOperation {
  operationId: string;
  userId: string;
  deviceId: string;
  grantId: string;
  cashRegisterId: string;
  occurredAt: Date;
  customerId: string | null;
  paymentMethod: PaymentMethod;
  discount: Prisma.Decimal;
  // Só na venda em dinheiro (as demais formas recebem exatamente o total)
  amountPaid: Prisma.Decimal | null;
  lines: OfflineSaleLine[];
  canonical: CanonicalSale;
  payloadHash: string;
}

interface CanonicalSale {
  v: number;
  kind: "sale.create";
  deviceId: string;
  grantId: string;
  cashRegisterId: string;
  occurredAt: string;
  customerId: string | null;
  paymentMethod: PaymentMethod;
  discount: string;
  amountPaid: string | null;
  // [productId, quantidade, preço praticado], em ordem estável
  items: [string, string, string][];
}

const invalid = (message: string) => new OperationRejected("invalid", message);

function readId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.length > MAX_ID_LENGTH) {
    throw invalid(`${label} inválido.`);
  }
  return value;
}

function readUuid(value: unknown, label: string): string {
  const id = parseOperationId(value);
  if (!id) throw invalid(`${label} inválido.`);
  return id;
}

/** Decimal enviado como texto (nunca como número, para não perder precisão). */
function readDecimal(value: unknown, pattern: RegExp, label: string): Prisma.Decimal {
  if (typeof value !== "string" || !pattern.test(value)) throw invalid(`${label} inválido.`);
  return new Prisma.Decimal(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** operationId da operação recebida, se houver um válido (para identificar a resposta). */
export function readOperationId(raw: unknown): string | null {
  return parseOperationId(asRecord(raw)?.operationId);
}

/** Converte o envelope do protocolo v1 (docs/OFFLINE.md seção 5) na operação normalizada. */
function parseOperation(raw: unknown): ParsedOperation {
  const op = asRecord(raw);
  if (!op) throw invalid("Operação inválida.");
  if (op.protocolVersion !== OFFLINE_OPERATIONS_PROTOCOL_VERSION) {
    throw invalid("Versão do protocolo não suportada. Atualize o app.");
  }
  if (op.kind !== "sale.create") throw invalid("Tipo de operação não suportado.");

  const operationId = readUuid(op.operationId, "Identificador da operação");
  const userId = readId(op.userId, "Operador");
  const deviceId = readUuid(op.deviceId, "Aparelho");
  const grantId = readUuid(op.grantId, "Autorização offline");
  const cashRegisterId = readId(op.cashRegisterId, "Caixa");
  if (typeof op.occurredAt !== "string") throw invalid("Data da venda inválida.");
  const occurredAt = new Date(op.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) throw invalid("Data da venda inválida.");

  const payload = asRecord(op.payload);
  if (!payload) throw invalid("Dados da venda inválidos.");

  const paymentMethod = payload.paymentMethod as PaymentMethod;
  if (!Object.values(PaymentMethod).includes(paymentMethod)) {
    throw invalid("Forma de pagamento inválida.");
  }
  const customerId =
    payload.customerId === null || payload.customerId === undefined
      ? null
      : readId(payload.customerId, "Cliente");
  const discount =
    payload.discount === undefined || payload.discount === null
      ? new Prisma.Decimal(0)
      : readDecimal(payload.discount, MONEY_RE, "Desconto");
  const amountPaid =
    paymentMethod === PaymentMethod.MONEY
      ? readDecimal(payload.amountPaid, MONEY_RE, "Valor recebido")
      : null;

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw invalid("A venda não tem itens.");
  }
  if (payload.items.length > MAX_ITEMS_PER_SALE) {
    throw invalid("Quantidade de itens excede o limite por venda.");
  }
  // Agrupa itens repetidos do mesmo produto com o mesmo preço praticado
  const grouped = new Map<string, OfflineSaleLine>();
  for (const rawItem of payload.items) {
    const item = asRecord(rawItem);
    if (!item) throw invalid("Item da venda inválido.");
    const productId = readId(item.productId, "Produto do item");
    const quantity = readDecimal(item.quantity, QUANTITY_RE, "Quantidade do item");
    const unitPrice = readDecimal(item.unitPrice, MONEY_RE, "Preço do item");
    if (quantity.lte(0)) throw invalid("A quantidade de cada item deve ser maior que zero.");
    const key = `${productId}\u0000${unitPrice.toFixed(2)}`;
    const previous = grouped.get(key);
    grouped.set(key, {
      productId,
      unitPrice,
      quantity: previous ? previous.quantity.add(quantity) : quantity,
    });
  }
  const lines = [...grouped.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, line]) => line);

  const canonical: CanonicalSale = {
    v: OFFLINE_SALE_PAYLOAD_VERSION,
    kind: "sale.create",
    deviceId,
    grantId,
    cashRegisterId,
    occurredAt: occurredAt.toISOString(),
    customerId,
    paymentMethod,
    discount: discount.toFixed(2),
    amountPaid: amountPaid?.toFixed(2) ?? null,
    items: lines.map((l) => [l.productId, l.quantity.toFixed(3), l.unitPrice.toFixed(2)]),
  };

  return {
    operationId,
    userId,
    deviceId,
    grantId,
    cashRegisterId,
    occurredAt,
    customerId,
    paymentMethod,
    discount,
    amountPaid,
    lines,
    canonical,
    payloadHash: hashPayload(canonical),
  };
}

/** Relê o payload guardado num conflito (mesmo formato canônico gravado na sincronização). */
function parseStoredOperation(
  operationId: string,
  userId: string,
  stored: unknown,
): ParsedOperation {
  const sale = asRecord(stored) as CanonicalSale | null;
  if (!sale || !Array.isArray(sale.items)) {
    throw new Error(`Payload guardado inválido na operação ${operationId}.`);
  }
  return parseOperation({
    protocolVersion: OFFLINE_OPERATIONS_PROTOCOL_VERSION,
    kind: sale.kind,
    operationId,
    userId,
    deviceId: sale.deviceId,
    grantId: sale.grantId,
    cashRegisterId: sale.cashRegisterId,
    occurredAt: sale.occurredAt,
    payload: {
      customerId: sale.customerId,
      paymentMethod: sale.paymentMethod,
      discount: sale.discount,
      amountPaid: sale.amountPaid,
      items: sale.items.map(([productId, quantity, unitPrice]) => ({
        productId,
        quantity,
        unitPrice,
      })),
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Regras da venda offline

type Tx = Prisma.TransactionClient;

interface SaleProduct {
  id: string;
  name: string;
  unit: Unit;
  salePrice: Prisma.Decimal;
  deletedAt: Date | null;
}

interface SaleCustomer {
  id: string;
  deletedAt: Date | null;
}

interface PricedLine extends OfflineSaleLine {
  product: SaleProduct;
  subtotal: Prisma.Decimal;
}

interface SaleTotals {
  lines: PricedLine[];
  total: Prisma.Decimal;
}

async function loadProducts(tx: Tx, op: ParsedOperation): Promise<Map<string, SaleProduct>> {
  // Inclui os excluídos: a venda de um produto excluído depois dela continua válida (seção 3.7)
  const products = await tx.product.findMany({
    where: { id: { in: [...new Set(op.lines.map((l) => l.productId))] } },
    select: { id: true, name: true, unit: true, salePrice: true, deletedAt: true },
  });
  return new Map(products.map((p) => [p.id, p]));
}

/**
 * Itens com o produto, subtotal pelo preço praticado e total; confere unidade e valores. Na
 * aprovação, a quantidade fracionada em unidade inteira fica a critério do gerente.
 */
function priceLines(
  op: ParsedOperation,
  products: Map<string, SaleProduct>,
  { allowFractions = false } = {},
): SaleTotals {
  let subtotal = new Prisma.Decimal(0);
  const lines = op.lines.map((line) => {
    const product = products.get(line.productId);
    if (!product) {
      throw new SaleConflict(
        SyncConflictReason.PRODUCT_NOT_FOUND,
        "Um dos produtos da venda não existe no servidor.",
      );
    }
    const lineSubtotal = line.quantity.mul(line.unitPrice).toDecimalPlaces(2);
    subtotal = subtotal.add(lineSubtotal);
    return { ...line, product, subtotal: lineSubtotal };
  });

  for (const line of lines) {
    if (allowFractions) break;
    if (INTEGER_UNITS.includes(line.product.unit) && !line.quantity.isInteger()) {
      throw new SaleConflict(
        SyncConflictReason.FRACTIONAL_QUANTITY,
        `"${line.product.name}" é vendido por ${line.product.unit} e aceita apenas quantidades ` +
          `inteiras (venda com ${line.quantity.toString()}).`,
      );
    }
  }

  if (op.discount.gt(subtotal)) {
    throw new SaleConflict(
      SyncConflictReason.INVALID_AMOUNTS,
      "O desconto da venda é maior que o subtotal.",
    );
  }
  const total = subtotal.sub(op.discount);
  if (op.amountPaid && op.amountPaid.lt(total)) {
    throw new SaleConflict(
      SyncConflictReason.INVALID_AMOUNTS,
      "O valor recebido em dinheiro é menor que o total da venda.",
    );
  }
  return { lines, total };
}

/**
 * Cada preço praticado precisa ter sido o preço de venda vigente em algum instante entre a
 * emissão da autorização (menos a tolerância) e o fim dela (seção 3.1). O histórico vem de
 * ProductPrice: o preço vigente num instante é o da linha mais recente com validFrom <= instante.
 */
async function assertPricesValid(tx: Tx, lines: PricedLine[], from: Date, to: Date) {
  const history = await tx.productPrice.findMany({
    where: {
      productId: { in: [...new Set(lines.map((l) => l.productId))] },
      validFrom: { lte: to },
    },
    orderBy: [{ validFrom: "desc" }, { id: "desc" }],
    select: { productId: true, salePrice: true, validFrom: true },
  });

  for (const line of lines) {
    let valid = false;
    // Do mais recente para o mais antigo: vale tudo o que começou dentro do período e o preço
    // que já estava vigente no início dele (a primeira linha com validFrom <= from)
    for (const row of history) {
      if (row.productId !== line.productId) continue;
      if (row.salePrice.eq(line.unitPrice)) {
        valid = true;
        break;
      }
      if (row.validFrom <= from) break;
    }
    if (!valid) {
      throw new SaleConflict(
        SyncConflictReason.PRICE_NOT_VALID,
        `O preço ${line.unitPrice.toFixed(2)} de "${line.product.name}" não vigorou no ` +
          "período da autorização offline.",
      );
    }
  }
}

/** Instante da venda limitado ao período permitido (seção 3.6). */
function clampOccurredAt(
  reported: Date,
  cash: CashRegister,
  grant: OfflineGrant | null,
  receivedAt: Date,
): Date {
  const lower = Math.max(cash.openedAt.getTime(), grant?.issuedAt.getTime() ?? 0);
  const upper = Math.max(
    lower,
    Math.min(grant?.expiresAt.getTime() ?? receivedAt.getTime(), receivedAt.getTime()),
  );
  return new Date(Math.min(Math.max(reported.getTime(), lower), upper));
}

interface WriteSaleInput {
  op: ParsedOperation;
  cash: CashRegister;
  grant: OfflineGrant | null;
  customer: SaleCustomer | null;
  totals: SaleTotals;
  receivedAt: Date;
  // Na aprovação, uma venda no Fiado gera o título (na sincronização ela é sempre conflito)
  createReceivable: boolean;
}

/**
 * Grava a venda e os efeitos dela (já dentro da transação, com o caixa travado): itens pelo preço
 * praticado, baixa de estoque sem exigir saldo, movimentações e pendências de conciliação.
 */
async function writeSale(tx: Tx, input: WriteSaleInput) {
  const { op, cash, grant, customer, totals, receivedAt } = input;
  const occurredAt = clampOccurredAt(op.occurredAt, cash, grant, receivedAt);

  // Baixa por produto (um produto pode aparecer com dois preços praticados)
  const quantityByProduct = new Map<string, Prisma.Decimal>();
  for (const line of totals.lines) {
    quantityByProduct.set(
      line.productId,
      (quantityByProduct.get(line.productId) ?? new Prisma.Decimal(0)).add(line.quantity),
    );
  }
  // Ordem estável das travas de linha de produto (evita impasse entre vendas concorrentes)
  const productIds = [...quantityByProduct.keys()].sort();
  const negative: { productId: string; quantity: Prisma.Decimal; stock: Prisma.Decimal }[] = [];
  for (const productId of productIds) {
    const quantity = quantityByProduct.get(productId)!;
    // Sem guarda de saldo: a venda offline já aconteceu (seção 3.2)
    const updated = await tx.product.update({
      where: { id: productId },
      data: { currentStock: { decrement: quantity } },
      select: { currentStock: true },
    });
    if (updated.currentStock.lt(0)) {
      negative.push({ productId, quantity, stock: updated.currentStock });
    }
  }

  const sale = await tx.sale.create({
    data: {
      total: totals.total,
      discount: op.discount,
      paymentMethod: op.paymentMethod,
      userId: op.userId,
      customerId: customer?.id ?? null,
      cashRegisterId: cash.id,
      occurredAt,
      createdAt: receivedAt,
      items: {
        create: totals.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          subtotal: line.subtotal,
        })),
      },
    },
    select: { id: true, code: true },
  });

  await tx.stockMovement.createMany({
    data: productIds.map((productId) => ({
      productId,
      type: MovementType.OUT,
      quantity: quantityByProduct.get(productId)!,
      reason: `Venda #${sale.code} (offline)`,
      userId: op.userId,
    })),
  });

  if (input.createReceivable && op.paymentMethod === PaymentMethod.ON_ACCOUNT && customer) {
    const settings = await getOnAccountSettings(tx);
    await tx.receivable.create({
      data: {
        saleId: sale.id,
        customerId: customer.id,
        amount: totals.total,
        dueDate: settings.dueDays === null ? null : storeDueDate(settings.dueDays, occurredAt),
      },
    });
  }

  const issues: Prisma.ReconciliationIssueCreateManyInput[] = [];
  for (const item of negative) {
    issues.push({
      type: ReconciliationIssueType.NEGATIVE_STOCK,
      saleId: sale.id,
      productId: item.productId,
      details: { quantity: item.quantity.toFixed(3), stockAfter: item.stock.toFixed(3) },
    });
  }
  if (cash.status === CashRegisterStatus.CLOSED) {
    issues.push({
      type: ReconciliationIssueType.POST_CLOSING_SALE,
      saleId: sale.id,
      details: {
        closedAt: cash.closedAt?.toISOString() ?? null,
        total: totals.total.toFixed(2),
        cashAmount: op.paymentMethod === PaymentMethod.MONEY ? totals.total.toFixed(2) : "0.00",
      },
    });
  }
  for (const line of totals.lines) {
    if (!line.unitPrice.eq(line.product.salePrice)) {
      issues.push({
        type: ReconciliationIssueType.PRICE_DIVERGENCE,
        saleId: sale.id,
        productId: line.productId,
        details: {
          practicedPrice: line.unitPrice.toFixed(2),
          currentPrice: line.product.salePrice.toFixed(2),
          quantity: line.quantity.toFixed(3),
        },
      });
    }
  }
  if (occurredAt.getTime() !== op.occurredAt.getTime()) {
    issues.push({
      type: ReconciliationIssueType.DATE_ADJUSTED,
      saleId: sale.id,
      details: { reportedAt: op.occurredAt.toISOString(), adjustedAt: occurredAt.toISOString() },
    });
  }
  if (customer?.deletedAt) {
    issues.push({
      type: ReconciliationIssueType.DELETED_CUSTOMER,
      saleId: sale.id,
      details: { customerId: customer.id, deletedAt: customer.deletedAt.toISOString() },
    });
  }
  if (issues.length > 0) await tx.reconciliationIssue.createMany({ data: issues });

  const [{ txid }] = await tx.$queryRaw<{ txid: string }[]>`
    SELECT pg_current_xact_id()::text AS txid
  `;
  return {
    sale: { id: sale.id, code: sale.code, occurredAt: occurredAt.toISOString() },
    appliedTxid: txid,
  };
}

/**
 * Confere a operação recebida e devolve o que falta para gravá-la, ou lança SaleConflict.
 * A ordem dos testes define o motivo quando há mais de um.
 */
async function evaluateOperation(
  tx: Tx,
  op: ParsedOperation,
  cash: CashRegister | null,
  device: OfflineDevice | null,
  grant: OfflineGrant | null,
  receivedAt: Date,
) {
  if (!cash) {
    throw new SaleConflict(
      SyncConflictReason.CASH_REGISTER_MISMATCH,
      "O caixa da venda não foi encontrado no servidor.",
    );
  }
  if (cash.userId !== op.userId) {
    throw new SaleConflict(
      SyncConflictReason.CASH_REGISTER_MISMATCH,
      "O caixa da venda pertence a outro operador.",
    );
  }
  if (!device) {
    throw new SaleConflict(
      SyncConflictReason.GRANT_MISMATCH,
      "O aparelho da venda não está registrado.",
    );
  }
  if (device.revokedAt) {
    throw new SaleConflict(
      SyncConflictReason.DEVICE_REVOKED,
      "O aparelho foi bloqueado para o PDV sem internet.",
    );
  }
  // Decisão de 04/10/2026: a autorização vencida na hora do envio não é conflito (a data da venda
  // já é limitada à validade dela); só a que não existe ou não corresponde à venda
  if (
    !grant ||
    grant.userId !== op.userId ||
    grant.deviceId !== op.deviceId ||
    grant.cashRegisterId !== op.cashRegisterId
  ) {
    throw new SaleConflict(
      SyncConflictReason.GRANT_MISMATCH,
      "A autorização offline não corresponde ao operador, ao aparelho ou ao caixa da venda.",
    );
  }
  if (op.paymentMethod === PaymentMethod.ON_ACCOUNT) {
    throw new SaleConflict(
      SyncConflictReason.ON_ACCOUNT_OFFLINE,
      "Venda no Fiado não é permitida sem internet.",
    );
  }

  const customer = await loadCustomer(tx, op);
  const totals = priceLines(op, await loadProducts(tx, op));
  await assertPricesValid(
    tx,
    totals.lines,
    new Date(grant.issuedAt.getTime() - PRICE_WINDOW_TOLERANCE_MS),
    new Date(Math.min(grant.expiresAt.getTime(), receivedAt.getTime())),
  );
  return { customer, totals };
}

async function loadCustomer(tx: Tx, op: ParsedOperation): Promise<SaleCustomer | null> {
  if (!op.customerId) return null;
  // Cliente excluído depois da venda: a venda é aceita, com pendência informativa
  const customer = await tx.customer.findUnique({
    where: { id: op.customerId },
    select: { id: true, deletedAt: true },
  });
  if (!customer) {
    throw new SaleConflict(
      SyncConflictReason.CUSTOMER_NOT_FOUND,
      "O cliente da venda não existe no servidor.",
    );
  }
  return customer;
}

// ---------------------------------------------------------------------------------------------
// Sincronização

const OPERATION_REUSED_ERROR =
  "Esta operação já foi enviada com outros dados. Ela fica guardada no aparelho para conferência.";

const operationResultSelect = {
  status: true,
  kind: true,
  userId: true,
  payloadHash: true,
  appliedTxid: true,
  conflictReason: true,
  conflictMessage: true,
  resolutionNote: true,
  sale: { select: { id: true, code: true, occurredAt: true } },
} satisfies Prisma.SyncOperationSelect;

type StoredOperation = Prisma.SyncOperationGetPayload<{ select: typeof operationResultSelect }>;

function storedResult(operationId: string, stored: StoredOperation): OfflineOperationResult {
  if (stored.status === SyncOperationStatus.CONFLICT) {
    return {
      operationId,
      status: "conflict",
      replayed: true,
      reason: stored.conflictReason ?? SyncConflictReason.GRANT_MISMATCH,
      message: stored.conflictMessage ?? "",
    };
  }
  if (stored.status === SyncOperationStatus.DISCARDED) {
    return {
      operationId,
      status: "discarded",
      replayed: true,
      message: stored.resolutionNote ?? "Descartada na conciliação.",
    };
  }
  if (!stored.sale) throw new Error(`Operação ${operationId} aplicada sem venda.`);
  return {
    operationId,
    status: stored.status === SyncOperationStatus.APPROVED ? "approved" : "applied",
    replayed: true,
    sale: {
      id: stored.sale.id,
      code: stored.sale.code,
      occurredAt: stored.sale.occurredAt.toISOString(),
    },
    appliedTxid: stored.appliedTxid?.toString() ?? "0",
  };
}

/** Resultado já gravado para a chave, ou null se ela é nova. Outros dados com a mesma chave: recusa. */
async function previousResult(op: ParsedOperation): Promise<OfflineOperationResult | null> {
  const stored = await prisma.syncOperation.findUnique({
    where: { id: op.operationId },
    select: operationResultSelect,
  });
  if (!stored) return null;
  if (
    stored.userId !== op.userId ||
    stored.kind !== SyncOperationKind.SALE_CREATE ||
    stored.payloadHash !== op.payloadHash
  ) {
    throw new OperationRejected("protocol_error", OPERATION_REUSED_ERROR);
  }
  return storedResult(op.operationId, stored);
}

/**
 * Grava a operação nova: aplicada (com os efeitos) ou conflito (sem efeito), numa transação. No
 * envio assistido (`submittedBy`, um gerente enviando a venda de outro operador), nada é aplicado:
 * a operação é sempre conflito, com o motivo encontrado ou ASSISTED_SUBMISSION, para um gerente
 * conferir e aprovar com a autoria original.
 */
async function recordOperation(
  op: ParsedOperation,
  receivedAt: Date,
  submittedBy: SessionUser | null = null,
): Promise<OfflineOperationResult> {
  return prisma.$transaction(async (tx) => {
    // O caixa original fica travado até o fim: serializa com vendas, sangrias e fechamento dele
    const cash = await lockCashRegisterById(tx, op.cashRegisterId);
    const [device, grant] = await Promise.all([
      tx.offlineDevice.findUnique({ where: { id: op.deviceId } }),
      tx.offlineGrant.findUnique({ where: { id: op.grantId } }),
    ]);

    // Chave gravada antes de qualquer efeito: uma tentativa concorrente com a mesma chave para
    // aqui (violação do índice único) e devolve o resultado da primeira
    await tx.syncOperation.create({
      data: {
        id: op.operationId,
        kind: SyncOperationKind.SALE_CREATE,
        status: SyncOperationStatus.APPLIED,
        payloadHash: op.payloadHash,
        payload: op.canonical as unknown as Prisma.InputJsonValue,
        userId: op.userId,
        // Só referências existentes; os ids enviados ficam no payload
        deviceId: device?.id ?? null,
        grantId: grant?.id ?? null,
        cashRegisterId: cash?.id ?? null,
        occurredAt: op.occurredAt,
        receivedAt,
        submittedById: submittedBy?.id ?? null,
      },
    });

    let evaluated: Awaited<ReturnType<typeof evaluateOperation>>;
    try {
      evaluated = await evaluateOperation(tx, op, cash, device, grant, receivedAt);
      if (submittedBy) {
        throw new SaleConflict(
          SyncConflictReason.ASSISTED_SUBMISSION,
          `Enviada por ${submittedBy.name} em nome do operador da venda. Confira antes de aprovar.`,
        );
      }
    } catch (error) {
      if (!(error instanceof SaleConflict)) throw error;
      // No envio assistido, o outro motivo encontrado vem primeiro e a origem fica registrada
      const message =
        submittedBy && error.reason !== SyncConflictReason.ASSISTED_SUBMISSION
          ? `${error.message} Enviada por ${submittedBy.name} em nome do operador da venda.`
          : error.message;
      await tx.syncOperation.update({
        where: { id: op.operationId },
        data: {
          status: SyncOperationStatus.CONFLICT,
          conflictReason: error.reason,
          conflictMessage: message,
        },
      });
      return {
        operationId: op.operationId,
        status: "conflict",
        replayed: false,
        reason: error.reason,
        message,
      };
    }

    const written = await writeSale(tx, {
      op,
      cash: cash!,
      grant,
      customer: evaluated.customer,
      totals: evaluated.totals,
      receivedAt,
      createReceivable: false,
    });
    await tx.syncOperation.update({
      where: { id: op.operationId },
      data: { saleId: written.sale.id, appliedTxid: BigInt(written.appliedTxid) },
    });
    return {
      operationId: op.operationId,
      status: "applied",
      replayed: false,
      sale: written.sale,
      appliedTxid: written.appliedTxid,
    };
  });
}

/**
 * Sincroniza uma operação offline do operador já autorizado (`pdv.use`). Nunca lança: cada
 * operação do lote recebe o próprio resultado. O operador envia as próprias operações; quem tem
 * `offline.reconcile` também envia as de outro operador guardadas no aparelho (envio assistido,
 * docs/OFFLINE.md seção 3.5), que chegam sempre como conflito, com a autoria original.
 */
export async function syncOfflineOperation(
  user: SessionUser,
  raw: unknown,
  receivedAt: Date = new Date(),
): Promise<OfflineOperationResult> {
  const operationId = readOperationId(raw);
  try {
    const op = parseOperation(raw);
    const assisted = op.userId !== user.id;
    if (assisted && !can(user.role, "offline.reconcile")) {
      throw new OperationRejected(
        "forbidden",
        "Esta venda é de outro operador e só pode ser enviada por ele ou por um gerente.",
      );
    }

    // Reenvio (resposta perdida, lote repetido, outra aba): é só um atalho que evita a trava do
    // caixa; a garantia é o índice único da chave, tratado abaixo
    const previous = await previousResult(op);
    if (previous) return previous;
    try {
      return await recordOperation(op, receivedAt, assisted ? user : null);
    } catch (error) {
      if (isDuplicateOperation(error)) {
        const concurrent = await previousResult(op);
        if (concurrent) return concurrent;
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof OperationRejected) {
      return { operationId, status: error.status, message: error.message };
    }
    console.error("Erro ao sincronizar operação offline:", error);
    return {
      operationId,
      status: "retry",
      message: "Não foi possível sincronizar agora. A venda continua guardada no aparelho.",
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Conciliação (Server Actions com "offline.reconcile")

export type ReconcileResult =
  { success: true; saleCode?: number } | { success: false; error: string };

export const RESOLUTION_NOTE_MIN = 3;
export const RESOLUTION_NOTE_MAX = 500;

/** Erro de conciliação com mensagem segura para a tela. */
class ReconcileError extends Error {}

function readNote(value: unknown, required: boolean): string | null {
  const note = typeof value === "string" ? value.trim() : "";
  if (!note) {
    if (required) throw new ReconcileError("Informe o motivo.");
    return null;
  }
  if (note.length < RESOLUTION_NOTE_MIN) {
    throw new ReconcileError(`O motivo precisa ter pelo menos ${RESOLUTION_NOTE_MIN} caracteres.`);
  }
  if (note.length > RESOLUTION_NOTE_MAX) {
    throw new ReconcileError(`O motivo pode ter no máximo ${RESOLUTION_NOTE_MAX} caracteres.`);
  }
  return note;
}

const ALREADY_RESOLVED = "Este conflito já foi resolvido ou não existe. Atualize a lista.";

/** Trava a operação em conflito até o fim da transação; devolve null se ela não está em conflito. */
async function lockConflict(tx: Tx, operationId: string) {
  const id = parseOperationId(operationId);
  if (!id) return null;
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "SyncOperation"
    WHERE "id" = ${id}::uuid AND "status" = 'CONFLICT'::"SyncOperationStatus"
    FOR UPDATE
  `;
  if (locked.length === 0) return null;
  return tx.syncOperation.findUniqueOrThrow({ where: { id } });
}

/**
 * Aprova um conflito: grava a venda com a autoria, o caixa e os preços originais (o gerente
 * assume a decisão sobre o motivo do conflito), com as pendências de conciliação de sempre.
 * Aprovar de novo não grava nada.
 */
export async function approveConflict(
  resolver: SessionUser,
  operationId: string,
  noteInput?: unknown,
): Promise<ReconcileResult> {
  try {
    const note = readNote(noteInput, false);
    const saleCode = await prisma.$transaction(async (tx) => {
      const stored = await lockConflict(tx, operationId);
      if (!stored) throw new ReconcileError(ALREADY_RESOLVED);
      const op = parseStoredOperation(stored.id, stored.userId, stored.payload);

      const cash = await lockCashRegisterById(tx, op.cashRegisterId);
      if (!cash) {
        throw new ReconcileError(
          "O caixa original da venda não existe. Descarte a operação informando o motivo.",
        );
      }
      // A autorização só limita a data quando é mesmo a desta venda
      const grant = stored.grantId
        ? await tx.offlineGrant.findUnique({ where: { id: stored.grantId } })
        : null;
      const matchingGrant =
        grant && grant.userId === op.userId && grant.cashRegisterId === cash.id ? grant : null;

      // Produto ou cliente inexistente e valores inconsistentes não têm como ser gravados
      let customer: SaleCustomer | null;
      let totals: SaleTotals;
      try {
        customer = await loadCustomer(tx, op);
        totals = priceLines(op, await loadProducts(tx, op), { allowFractions: true });
      } catch (error) {
        if (error instanceof SaleConflict) {
          throw new ReconcileError(`${error.message} Descarte a operação informando o motivo.`);
        }
        throw error;
      }
      if (op.paymentMethod === PaymentMethod.ON_ACCOUNT && !customer) {
        throw new ReconcileError("Venda no Fiado sem cliente. Descarte a operação.");
      }

      const written = await writeSale(tx, {
        op,
        cash,
        grant: matchingGrant,
        customer,
        totals,
        receivedAt: stored.receivedAt,
        createReceivable: true,
      });
      await tx.syncOperation.update({
        where: { id: stored.id },
        data: {
          status: SyncOperationStatus.APPROVED,
          saleId: written.sale.id,
          appliedTxid: BigInt(written.appliedTxid),
          resolvedById: resolver.id,
          resolvedAt: new Date(),
          resolutionNote: note,
        },
      });
      return written.sale.code;
    });
    return { success: true, saleCode };
  } catch (error) {
    if (error instanceof ReconcileError) return { success: false, error: error.message };
    console.error("Erro ao aprovar conflito offline:", error);
    return { success: false, error: "Não foi possível aprovar agora. Tente novamente." };
  }
}

/** Descarta um conflito com motivo: nenhum efeito, a decisão fica registrada. */
export async function discardConflict(
  resolver: SessionUser,
  operationId: string,
  noteInput: unknown,
): Promise<ReconcileResult> {
  try {
    const note = readNote(noteInput, true);
    const id = parseOperationId(operationId);
    const updated = id
      ? await prisma.syncOperation.updateMany({
          where: { id, status: SyncOperationStatus.CONFLICT },
          data: {
            status: SyncOperationStatus.DISCARDED,
            resolvedById: resolver.id,
            resolvedAt: new Date(),
            resolutionNote: note,
          },
        })
      : { count: 0 };
    if (updated.count === 0) return { success: false, error: ALREADY_RESOLVED };
    return { success: true };
  } catch (error) {
    if (error instanceof ReconcileError) return { success: false, error: error.message };
    console.error("Erro ao descartar conflito offline:", error);
    return { success: false, error: "Não foi possível descartar agora. Tente novamente." };
  }
}

/** Registra a ciência de uma pendência de conciliação (uma única vez). */
export async function acknowledgeIssue(
  resolver: SessionUser,
  issueId: string,
  noteInput?: unknown,
): Promise<ReconcileResult> {
  try {
    const note = readNote(noteInput, false);
    const updated =
      typeof issueId === "string" && issueId
        ? await prisma.reconciliationIssue.updateMany({
            where: { id: issueId, acknowledgedAt: null },
            data: { acknowledgedById: resolver.id, acknowledgedAt: new Date(), note },
          })
        : { count: 0 };
    if (updated.count === 0) {
      return { success: false, error: "Esta pendência já foi conferida ou não existe." };
    }
    return { success: true };
  } catch (error) {
    if (error instanceof ReconcileError) return { success: false, error: error.message };
    console.error("Erro ao registrar ciência da pendência:", error);
    return { success: false, error: "Não foi possível registrar agora. Tente novamente." };
  }
}
