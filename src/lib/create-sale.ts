import { MovementType, PaymentMethod, Prisma, SyncOperationKind, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockOwnOpenCashRegisterById } from "@/lib/cash-register";
import { getOnAccountSettings, unpaidReceivables, type OnAccountSettings } from "@/lib/on-account";
import { formatStoreDate, startOfStoreDay, storeDueDate } from "@/lib/store-time";
import { hashPayload, isDuplicateOperation, parseOperationId } from "@/lib/sync-operation";
import { formatCurrency } from "@/lib/utils";

// Registro da venda (usado apenas no servidor). A Server Action createSale autoriza o operador
// e chama registerSale; a sincronização offline (#38) vai reaproveitar o mesmo núcleo.
//
// Idempotência (issue #35): cada tentativa de venda tem um operationId gerado no cliente. A
// SyncOperation é gravada na mesma transação da venda, dos itens, do estoque e do título:
// - mesma chave e mesmo payload → devolve a venda já gravada, sem novos efeitos;
// - mesma chave e payload diferente → recusada;
// - falha ou rollback → nenhum registro, e a mesma chave pode ser tentada de novo.

// O cliente informa apenas O QUE está sendo vendido. Preços, subtotais, total e troco
// são sempre recalculados no servidor a partir do banco (fonte da verdade).
export interface SaleItemInput {
  productId: string;
  quantity: number;
}

export interface CreateSaleInput {
  // UUID gerado pelo PDV por tentativa de finalização e reaproveitado nos reenvios
  operationId: string;
  // Caixa aberto em que a venda começou (o PDV recebe o id ao carregar)
  cashRegisterId: string;
  customerId?: string | null;
  paymentMethod: PaymentMethod;
  discount: number;
  amountPaid?: number;
  items: SaleItemInput[];
}

// Venda serializável para o cliente (Decimals convertidos para number)
export interface SaleReceipt {
  id: string;
  code: number;
  total: number;
  discount: number;
  paymentMethod: PaymentMethod;
  amountPaid: number;
  change: number;
  occurredAt: string;
  createdAt: string;
  userName: string;
  customerName: string;
  customerDocument: string | null;
  items: {
    id: string;
    productId: string;
    productName: string;
    unit: Unit;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }[];
}

export type CreateSaleResult =
  { success: true; data: SaleReceipt; replayed: boolean } | { success: false; error: string };

const INTEGER_UNITS: Unit[] = [Unit.UN, Unit.CX];
const MAX_ITEMS_PER_SALE = 500;
// Versão do payload canônico usado no hash (muda se o formato mudar)
const SALE_PAYLOAD_VERSION = 1;

const OPERATION_CONFLICT_ERROR =
  "Esta venda já foi enviada com outros dados. Recarregue o PDV e confira o histórico de vendas " +
  "antes de registrar de novo.";

// Erro de regra de negócio: a mensagem é segura para exibir ao operador.
class SaleValidationError extends Error {}

function toNumberOrNaN(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

interface ParsedSale {
  operationId: string;
  cashRegisterId: string;
  customerId: string | null;
  paymentMethod: PaymentMethod;
  discount: Prisma.Decimal;
  // Só na venda em dinheiro (as demais formas recebem exatamente o total)
  amountPaid: Prisma.Decimal | null;
  quantities: Map<string, Prisma.Decimal>;
  payloadHash: string;
}

function parseSaleInput(data: CreateSaleInput): ParsedSale {
  const operationId = parseOperationId(data?.operationId);
  if (!operationId) {
    throw new SaleValidationError("Identificador da venda inválido. Recarregue o PDV.");
  }
  if (typeof data.cashRegisterId !== "string" || !data.cashRegisterId) {
    throw new SaleValidationError("Caixa da venda não informado. Recarregue o PDV.");
  }

  if (!Array.isArray(data.items) || data.items.length === 0) {
    throw new SaleValidationError(
      "O carrinho está vazio. Adicione produtos antes de finalizar a venda.",
    );
  }
  if (data.items.length > MAX_ITEMS_PER_SALE) {
    throw new SaleValidationError("Quantidade de itens excede o limite por venda.");
  }
  if (!Object.values(PaymentMethod).includes(data.paymentMethod)) {
    throw new SaleValidationError("Forma de pagamento inválida.");
  }

  // Agrupa itens repetidos do mesmo produto
  const quantities = new Map<string, Prisma.Decimal>();
  for (const item of data.items) {
    const quantity = toNumberOrNaN(item?.quantity);
    if (typeof item?.productId !== "string" || !item.productId) {
      throw new SaleValidationError("Item da venda sem produto.");
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new SaleValidationError("A quantidade de cada item deve ser maior que zero.");
    }
    const qty = new Prisma.Decimal(quantity).toDecimalPlaces(3);
    if (qty.lte(0)) {
      throw new SaleValidationError("A quantidade de cada item deve ser maior que zero.");
    }
    quantities.set(
      item.productId,
      (quantities.get(item.productId) ?? new Prisma.Decimal(0)).add(qty),
    );
  }

  const discountInput =
    data.discount === undefined || data.discount === null ? 0 : toNumberOrNaN(data.discount);
  if (!Number.isFinite(discountInput) || discountInput < 0) {
    throw new SaleValidationError("O desconto não pode ser negativo.");
  }
  const discount = new Prisma.Decimal(discountInput).toDecimalPlaces(2);

  let amountPaid: Prisma.Decimal | null = null;
  if (data.paymentMethod === PaymentMethod.MONEY) {
    const paid = toNumberOrNaN(data.amountPaid);
    if (!Number.isFinite(paid) || paid < 0) {
      throw new SaleValidationError("O valor recebido não pode ser menor que o total da venda.");
    }
    amountPaid = new Prisma.Decimal(paid).toDecimalPlaces(2);
  }

  const customerId = data.customerId || null;
  if (data.paymentMethod === PaymentMethod.ON_ACCOUNT && !customerId) {
    throw new SaleValidationError("Venda no Fiado exige um cliente vinculado.");
  }

  // Payload canônico: valores normalizados como texto e itens em ordem estável, para que o
  // mesmo carrinho gere sempre o mesmo hash
  const payloadHash = hashPayload({
    v: SALE_PAYLOAD_VERSION,
    cashRegisterId: data.cashRegisterId,
    customerId,
    paymentMethod: data.paymentMethod,
    discount: discount.toFixed(2),
    amountPaid: amountPaid?.toFixed(2) ?? null,
    items: [...quantities.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([productId, qty]) => [productId, qty.toFixed(3)]),
  });

  return {
    operationId,
    cashRegisterId: data.cashRegisterId,
    customerId,
    paymentMethod: data.paymentMethod,
    discount,
    amountPaid,
    quantities,
    payloadHash,
  };
}

/**
 * Regras do Fiado configuradas na loja (issue #29): cliente com título vencido e limite de
 * crédito (saldo em aberto + esta venda). Roda na transação da venda, com a linha do cliente
 * travada, para que duas vendas simultâneas não ultrapassem juntas o limite.
 */
async function assertOnAccountAllowed(
  tx: Prisma.TransactionClient,
  settings: OnAccountSettings,
  customer: { id: string; name: string },
  total: Prisma.Decimal,
) {
  if (!settings.blockOverdue && settings.creditLimit === null) return;

  await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customer.id} FOR UPDATE`;

  if (settings.blockOverdue) {
    const overdue = await tx.receivable.findFirst({
      where: {
        customerId: customer.id,
        ...unpaidReceivables,
        dueDate: { lt: startOfStoreDay() },
      },
      orderBy: { dueDate: "asc" },
      select: { dueDate: true, sale: { select: { code: true } } },
    });
    if (overdue?.dueDate) {
      throw new SaleValidationError(
        `Venda no Fiado bloqueada: ${customer.name} tem título vencido em aberto ` +
          `(venda #${overdue.sale.code}, vencimento ${formatStoreDate(overdue.dueDate)}). ` +
          "Receba o título em Contas a Receber para liberar novas compras no Fiado.",
      );
    }
  }

  if (settings.creditLimit !== null) {
    const open = await tx.receivable.aggregate({
      where: { customerId: customer.id, ...unpaidReceivables },
      _sum: { amount: true, paidAmount: true },
    });
    const balance = (open._sum.amount ?? new Prisma.Decimal(0)).sub(
      open._sum.paidAmount ?? new Prisma.Decimal(0),
    );
    if (balance.add(total).gt(settings.creditLimit)) {
      const available = Prisma.Decimal.max(settings.creditLimit.sub(balance), 0);
      throw new SaleValidationError(
        `Limite de crédito do Fiado excedido para ${customer.name}: ` +
          `limite ${formatCurrency(settings.creditLimit.toNumber())}, ` +
          `saldo em aberto ${formatCurrency(balance.toNumber())}, ` +
          `disponível ${formatCurrency(available.toNumber())}. ` +
          `Esta venda: ${formatCurrency(total.toNumber())}.`,
      );
    }
  }
}

/** Grava a venda e os efeitos numa única transação; devolve o id da venda. */
async function persistSale(userId: string, sale: ParsedSale): Promise<string> {
  return prisma.$transaction(async (tx) => {
    // A venda pertence ao caixa em que começou, que precisa continuar aberto e ser do operador.
    // A trava também serializa as tentativas concorrentes do mesmo caixa.
    const cashRegister = await lockOwnOpenCashRegisterById(tx, sale.cashRegisterId, userId);
    if (!cashRegister) {
      throw new SaleValidationError(
        "O caixa desta venda não está aberto. Recarregue o PDV (e abra o caixa, se preciso) " +
          "antes de registrar a venda.",
      );
    }

    // Chave da operação gravada antes de qualquer efeito: uma tentativa concorrente com a
    // mesma chave para aqui (violação do índice único) e devolve a venda da primeira
    const now = new Date();
    await tx.syncOperation.create({
      data: {
        id: sale.operationId,
        kind: SyncOperationKind.SALE_CREATE,
        payloadHash: sale.payloadHash,
        userId,
        cashRegisterId: cashRegister.id,
        occurredAt: now,
        receivedAt: now,
      },
    });

    // Fiado desligado nas Configurações da Loja: recusa mesmo com chamada direta à action
    const onAccount =
      sale.paymentMethod === PaymentMethod.ON_ACCOUNT ? await getOnAccountSettings(tx) : null;
    if (onAccount && !onAccount.enabled) {
      throw new SaleValidationError(
        "A venda no Fiado está desativada nas Configurações da Loja. Escolha outra forma de pagamento.",
      );
    }

    let customer: { id: string; name: string } | null = null;
    if (sale.customerId) {
      customer = await tx.customer.findFirst({
        where: { id: sale.customerId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!customer) {
        throw new SaleValidationError("Cliente selecionado não foi encontrado.");
      }
    }

    const productIds = [...sale.quantities.keys()];
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
      select: { id: true, name: true, unit: true, salePrice: true },
    });
    const productsById = new Map(products.map((p) => [p.id, p]));

    let subtotal = new Prisma.Decimal(0);
    const items = productIds.map((productId) => {
      const product = productsById.get(productId);
      if (!product) {
        throw new SaleValidationError(
          "Um dos produtos do carrinho não existe mais. Atualize a tela.",
        );
      }
      const quantity = sale.quantities.get(productId)!;
      if (INTEGER_UNITS.includes(product.unit) && !quantity.isInteger()) {
        throw new SaleValidationError(
          `"${product.name}" é vendido por ${product.unit} e aceita apenas quantidades inteiras.`,
        );
      }
      const itemSubtotal = quantity.mul(product.salePrice).toDecimalPlaces(2);
      subtotal = subtotal.add(itemSubtotal);
      return { product, quantity, unitPrice: product.salePrice, subtotal: itemSubtotal };
    });

    if (sale.discount.gt(subtotal)) {
      throw new SaleValidationError("O desconto não pode ser maior que o subtotal da venda.");
    }
    const total = subtotal.sub(sale.discount);

    if (sale.amountPaid && sale.amountPaid.lt(total)) {
      throw new SaleValidationError("O valor recebido não pode ser menor que o total da venda.");
    }

    if (onAccount && customer) {
      await assertOnAccountAllowed(tx, onAccount, customer, total);
    }

    // Baixa de estoque com guarda atômica: só decrementa se houver saldo suficiente,
    // evitando estoque negativo mesmo com vendas simultâneas.
    for (const item of items) {
      const updated = await tx.product.updateMany({
        where: { id: item.product.id, currentStock: { gte: item.quantity } },
        data: { currentStock: { decrement: item.quantity } },
      });
      if (updated.count === 0) {
        throw new SaleValidationError(`Estoque insuficiente para "${item.product.name}".`);
      }
    }

    // Venda online: aconteceu quando o servidor a recebeu (occurredAt = createdAt)
    const newSale = await tx.sale.create({
      data: {
        total,
        discount: sale.discount,
        paymentMethod: sale.paymentMethod,
        userId,
        customerId: sale.customerId,
        cashRegisterId: cashRegister.id,
        occurredAt: now,
        createdAt: now,
        items: {
          create: items.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal,
          })),
        },
      },
      select: { id: true, code: true },
    });

    await tx.syncOperation.update({
      where: { id: sale.operationId },
      data: { saleId: newSale.id },
    });

    await tx.stockMovement.createMany({
      data: items.map((item) => ({
        productId: item.product.id,
        type: MovementType.OUT,
        quantity: item.quantity,
        reason: `Venda #${newSale.code}`,
        userId,
      })),
    });

    // Venda no Fiado gera o título em Contas a Receber, com vencimento se houver prazo
    // configurado (dia da venda + N dias, no fuso da loja)
    if (onAccount && sale.customerId) {
      const dueDate = onAccount.dueDays === null ? null : storeDueDate(onAccount.dueDays, now);
      await tx.receivable.create({
        data: { saleId: newSale.id, customerId: sale.customerId, amount: total, dueDate },
      });
    }

    return newSale.id;
  });
}

async function loadReceipt(saleId: string, amountPaidInput: Prisma.Decimal | null) {
  const sale = await prisma.sale.findUniqueOrThrow({
    where: { id: saleId },
    include: {
      user: { select: { name: true } },
      customer: { select: { name: true, document: true } },
      items: {
        include: { product: { select: { name: true, unit: true } } },
        orderBy: { id: "asc" },
      },
    },
  });

  const amountPaid = amountPaidInput ?? sale.total;
  const receipt: SaleReceipt = {
    id: sale.id,
    code: sale.code,
    total: sale.total.toNumber(),
    discount: sale.discount.toNumber(),
    paymentMethod: sale.paymentMethod,
    amountPaid: amountPaid.toNumber(),
    change: amountPaid.sub(sale.total).toNumber(),
    occurredAt: sale.occurredAt.toISOString(),
    createdAt: sale.createdAt.toISOString(),
    userName: sale.user?.name || "Vendedor",
    customerName: sale.customer?.name || "Consumidor Final",
    customerDocument: sale.customer?.document || null,
    items: sale.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.product.name,
      unit: item.product.unit,
      quantity: item.quantity.toNumber(),
      unitPrice: item.unitPrice.toNumber(),
      subtotal: item.subtotal.toNumber(),
    })),
  };
  return receipt;
}

/**
 * Resultado de uma operação já gravada com a mesma chave, ou null se a chave é nova. A chave
 * só vale para o mesmo operador, o mesmo tipo e o mesmo payload; o resto é recusado.
 */
async function findPreviousResult(
  userId: string,
  sale: ParsedSale,
): Promise<CreateSaleResult | null> {
  const operation = await prisma.syncOperation.findUnique({
    where: { id: sale.operationId },
    select: { userId: true, kind: true, payloadHash: true, saleId: true },
  });
  if (!operation) return null;
  if (
    operation.userId !== userId ||
    operation.kind !== SyncOperationKind.SALE_CREATE ||
    operation.payloadHash !== sale.payloadHash ||
    !operation.saleId
  ) {
    throw new SaleValidationError(OPERATION_CONFLICT_ERROR);
  }
  return {
    success: true,
    data: await loadReceipt(operation.saleId, sale.amountPaid),
    replayed: true,
  };
}

/** Registra a venda do operador já autorizado (`pdv.use`), com idempotência pela chave. */
export async function registerSale(
  userId: string,
  data: CreateSaleInput,
): Promise<CreateSaleResult> {
  try {
    const sale = parseSaleInput(data);

    // Reenvio de uma venda já gravada (resposta perdida, clique repetido). É só um atalho que
    // evita esperar a trava do caixa: a garantia é o índice único da chave, tratado abaixo
    const previous = await findPreviousResult(userId, sale);
    if (previous) return previous;

    let saleId: string;
    try {
      saleId = await persistSale(userId, sale);
    } catch (error) {
      // A chave já foi gravada (tentativa concorrente ou reenvio): devolve a venda dela
      if (isDuplicateOperation(error)) {
        const concurrent = await findPreviousResult(userId, sale);
        if (concurrent) return concurrent;
      }
      throw error;
    }

    return { success: true, data: await loadReceipt(saleId, sale.amountPaid), replayed: false };
  } catch (error) {
    if (error instanceof SaleValidationError) {
      return { success: false, error: error.message };
    }
    console.error("Erro ao registrar venda:", error);
    return { success: false, error: "Falha ao processar a venda no banco de dados." };
  }
}
