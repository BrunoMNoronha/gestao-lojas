"use server";

import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/authz";
import { revalidatePath } from "next/cache";
import { PaymentMethod, MovementType, Prisma, Unit } from "@prisma/client";
import { lockOpenCashRegister } from "@/lib/cash-register";
import { getOnAccountSettings, unpaidReceivables, type OnAccountSettings } from "@/lib/on-account";
import { formatStoreDate, startOfStoreDay, storeDueDate } from "@/lib/store-time";
import { formatCurrency } from "@/lib/utils";

// O cliente informa apenas O QUE está sendo vendido. Preços, subtotais, total e troco
// são sempre recalculados no servidor a partir do banco (fonte da verdade).
export interface SaleItemInput {
  productId: string;
  quantity: number;
}

export interface CreateSaleInput {
  customerId?: string | null;
  paymentMethod: PaymentMethod;
  discount: number;
  amountPaid?: number;
  items: SaleItemInput[];
}

const INTEGER_UNITS: Unit[] = [Unit.UN, Unit.CX];
const MAX_ITEMS_PER_SALE = 500;

// Erro de regra de negócio: a mensagem é segura para exibir ao operador.
class SaleValidationError extends Error {}

function toNumberOrNaN(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
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

export async function createSale(data: CreateSaleInput) {
  try {
    // 1. Autenticação: a venda é sempre atribuída ao operador logado.
    const authz = await authorize("pdv.use");
    if (!authz.ok) {
      return { success: false, error: authz.error };
    }
    const userId = authz.user.id;

    // 2. Validação do payload
    if (!Array.isArray(data?.items) || data.items.length === 0) {
      return {
        success: false,
        error: "O carrinho está vazio. Adicione produtos antes de finalizar a venda.",
      };
    }
    if (data.items.length > MAX_ITEMS_PER_SALE) {
      return { success: false, error: "Quantidade de itens excede o limite por venda." };
    }
    if (!Object.values(PaymentMethod).includes(data.paymentMethod)) {
      return { success: false, error: "Forma de pagamento inválida." };
    }

    // Agrupa itens repetidos do mesmo produto
    const quantities = new Map<string, Prisma.Decimal>();
    for (const item of data.items) {
      const quantity = toNumberOrNaN(item?.quantity);
      if (typeof item?.productId !== "string" || !item.productId) {
        return { success: false, error: "Item da venda sem produto." };
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return { success: false, error: "A quantidade de cada item deve ser maior que zero." };
      }
      const qty = new Prisma.Decimal(quantity).toDecimalPlaces(3);
      if (qty.lte(0)) {
        return { success: false, error: "A quantidade de cada item deve ser maior que zero." };
      }
      quantities.set(
        item.productId,
        (quantities.get(item.productId) ?? new Prisma.Decimal(0)).add(qty),
      );
    }

    const discountInput =
      data.discount === undefined || data.discount === null ? 0 : toNumberOrNaN(data.discount);
    if (!Number.isFinite(discountInput) || discountInput < 0) {
      return { success: false, error: "O desconto não pode ser negativo." };
    }
    const discount = new Prisma.Decimal(discountInput).toDecimalPlaces(2);

    const customerId = data.customerId || null;
    if (data.paymentMethod === PaymentMethod.ON_ACCOUNT && !customerId) {
      return { success: false, error: "Venda no Fiado exige um cliente vinculado." };
    }

    // 3. Persistência atômica: venda, itens, baixa de estoque e movimentações
    const sale = await prisma.$transaction(async (tx) => {
      // Toda venda pertence ao turno de caixa aberto do operador
      const cashRegister = await lockOpenCashRegister(tx, userId);
      if (!cashRegister) {
        throw new SaleValidationError("Abra o caixa antes de registrar vendas.");
      }

      // Fiado desligado nas Configurações da Loja: recusa mesmo com chamada direta à action
      const onAccount =
        data.paymentMethod === PaymentMethod.ON_ACCOUNT ? await getOnAccountSettings(tx) : null;
      if (onAccount && !onAccount.enabled) {
        throw new SaleValidationError(
          "A venda no Fiado está desativada nas Configurações da Loja. Escolha outra forma de pagamento.",
        );
      }

      let customer: { id: string; name: string } | null = null;
      if (customerId) {
        customer = await tx.customer.findUnique({
          where: { id: customerId },
          select: { id: true, name: true },
        });
        if (!customer) {
          throw new SaleValidationError("Cliente selecionado não foi encontrado.");
        }
      }

      const productIds = [...quantities.keys()];
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
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
        const quantity = quantities.get(productId)!;
        if (INTEGER_UNITS.includes(product.unit) && !quantity.isInteger()) {
          throw new SaleValidationError(
            `"${product.name}" é vendido por ${product.unit} e aceita apenas quantidades inteiras.`,
          );
        }
        const itemSubtotal = quantity.mul(product.salePrice).toDecimalPlaces(2);
        subtotal = subtotal.add(itemSubtotal);
        return { product, quantity, unitPrice: product.salePrice, subtotal: itemSubtotal };
      });

      if (discount.gt(subtotal)) {
        throw new SaleValidationError("O desconto não pode ser maior que o subtotal da venda.");
      }
      const total = subtotal.sub(discount);

      if (data.paymentMethod === PaymentMethod.MONEY) {
        const paid = toNumberOrNaN(data.amountPaid);
        if (!Number.isFinite(paid) || new Prisma.Decimal(paid).toDecimalPlaces(2).lt(total)) {
          throw new SaleValidationError(
            "O valor recebido não pode ser menor que o total da venda.",
          );
        }
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

      const newSale = await tx.sale.create({
        data: {
          total,
          discount,
          paymentMethod: data.paymentMethod,
          userId,
          customerId,
          cashRegisterId: cashRegister.id,
          items: {
            create: items.map((item) => ({
              productId: item.product.id,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              subtotal: item.subtotal,
            })),
          },
        },
        include: {
          user: { select: { name: true } },
          customer: { select: { name: true, document: true } },
          items: {
            include: {
              product: { select: { name: true, unit: true } },
            },
          },
        },
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
      if (onAccount && customerId) {
        const dueDate =
          onAccount.dueDays === null ? null : storeDueDate(onAccount.dueDays, newSale.createdAt);
        await tx.receivable.create({
          data: { saleId: newSale.id, customerId, amount: total, dueDate },
        });
      }

      return newSale;
    });

    revalidatePath("/admin/pdv");
    revalidatePath("/admin/produtos");
    revalidatePath("/admin/estoque");
    revalidatePath("/admin/caixa");
    revalidatePath("/admin/contas-a-receber");

    const total = Number(sale.total);
    const amountPaid =
      sale.paymentMethod === PaymentMethod.MONEY
        ? new Prisma.Decimal(toNumberOrNaN(data.amountPaid)).toDecimalPlaces(2).toNumber()
        : total;

    // Converte Decimals do Prisma para números serializáveis no cliente
    const formattedSale = {
      id: sale.id,
      code: sale.code,
      total,
      discount: Number(sale.discount),
      paymentMethod: sale.paymentMethod,
      amountPaid,
      change: new Prisma.Decimal(amountPaid).sub(sale.total).toNumber(),
      createdAt: sale.createdAt.toISOString(),
      userName: sale.user?.name || "Vendedor",
      customerName: sale.customer?.name || "Consumidor Final",
      customerDocument: sale.customer?.document || null,
      items: sale.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        unit: item.product.unit,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        subtotal: Number(item.subtotal),
      })),
    };

    return { success: true, data: formattedSale };
  } catch (error) {
    if (error instanceof SaleValidationError) {
      return { success: false, error: error.message };
    }
    console.error("Erro ao registrar venda:", error);
    return { success: false, error: "Falha ao processar a venda no banco de dados." };
  }
}
