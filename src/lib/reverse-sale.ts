import {
  CashMovementType,
  CashRegisterStatus,
  MovementType,
  PaymentMethod,
  Prisma,
  ReceivableStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeCashSummary, lockCashRegisterById } from "@/lib/cash-register";
import { formatCurrency } from "@/lib/utils";

// Estorno da venda inteira (usado apenas no servidor; a Server Action reverseSaleAction autoriza
// com "sales.reverse"). Numa única transação:
// - devolve o estoque de cada item (movimentação IN "Estorno da venda #N");
// - dinheiro: se o caixa da venda ainda está aberto, a venda só deixa de contar no esperado dele
//   (reversedInRegister). Com o caixa fechado, o fechamento não muda e o valor sai como sangria
//   no caixa aberto de quem estorna. PIX e cartões são devolvidos fora do sistema;
// - Fiado: o título é cancelado e os recebimentos em dinheiro saem como sangria no caixa aberto
//   de quem estorna (os demais meios também são devolvidos fora do sistema).
// A venda continua listada, marcada como estornada, e sai de todos os totais.

export const REVERSAL_REASON_MIN = 3;
export const REVERSAL_REASON_MAX = 500;

export interface ReverseSaleInput {
  saleId: string;
  reason: string;
}

export type ReverseSaleResult =
  | {
      success: true;
      data: {
        code: number;
        // Dinheiro devolvido pela gaveta: no próprio caixa da venda ou em sangria
        cashRefund: number;
        cashRefundFrom: "SALE_REGISTER" | "OWN_REGISTER" | null;
      };
    }
  | { success: false; error: string };

/** Erro de estorno com mensagem segura para a tela. */
class SaleReversalError extends Error {}

function readReason(value: unknown): string {
  const reason = typeof value === "string" ? value.trim() : "";
  if (!reason) throw new SaleReversalError("Informe o motivo do estorno.");
  if (reason.length < REVERSAL_REASON_MIN) {
    throw new SaleReversalError(
      `O motivo precisa ter pelo menos ${REVERSAL_REASON_MIN} caracteres.`,
    );
  }
  if (reason.length > REVERSAL_REASON_MAX) {
    throw new SaleReversalError(`O motivo pode ter no máximo ${REVERSAL_REASON_MAX} caracteres.`);
  }
  return reason;
}

async function persistReversal(userId: string, saleId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      select: {
        id: true,
        code: true,
        total: true,
        paymentMethod: true,
        cashRegisterId: true,
        reversedAt: true,
        items: { select: { productId: true, quantity: true } },
        receivable: {
          select: {
            id: true,
            paidAmount: true,
            status: true,
            payments: { select: { amount: true, method: true } },
          },
        },
      },
    });
    if (!sale) throw new SaleReversalError("Venda não encontrada. Atualize a tela.");
    if (sale.reversedAt) throw new SaleReversalError("Esta venda já foi estornada.");

    // Trava o caixa da venda (aberto ou fechado: serializa com o fechamento, vendas e sangrias)
    // e o caixa aberto de quem estorna, sempre na ordem dos ids para dois estornos cruzados não
    // se travarem mutuamente. O estado de cada um é conferido só depois da trava.
    const own = await tx.cashRegister.findUnique({
      where: { openUserId: userId },
      select: { id: true },
    });
    const ids = [...new Set([sale.cashRegisterId, own?.id].filter((id): id is string => !!id))];
    const locked = new Map<string, NonNullable<Awaited<ReturnType<typeof lockCashRegisterById>>>>();
    for (const id of ids.sort()) {
      const register = await lockCashRegisterById(tx, id);
      if (register) locked.set(id, register);
    }
    const saleRegister = sale.cashRegisterId ? locked.get(sale.cashRegisterId) : undefined;
    const ownRegister = own ? locked.get(own.id) : undefined;
    const ownOpen =
      ownRegister?.status === CashRegisterStatus.OPEN && ownRegister.openUserId === userId
        ? ownRegister
        : null;

    const zero = new Prisma.Decimal(0);
    const label = `Estorno da venda #${sale.code}`;

    // Quanto sai da gaveta e de onde
    let reversedInRegister = false;
    let withdrawal = zero;
    if (sale.paymentMethod === PaymentMethod.MONEY) {
      if (saleRegister?.status === CashRegisterStatus.OPEN) {
        reversedInRegister = true;
        const { expectedCash } = await computeCashSummary(tx, saleRegister.id);
        if (sale.total.gt(expectedCash)) {
          throw new SaleReversalError(
            "Dinheiro insuficiente no caixa da venda para devolver o valor.",
          );
        }
      } else {
        withdrawal = sale.total;
      }
    } else if (sale.paymentMethod === PaymentMethod.ON_ACCOUNT && sale.receivable) {
      withdrawal = sale.receivable.payments
        .filter((p) => p.method === PaymentMethod.MONEY)
        .reduce((sum, p) => sum.add(p.amount), zero);
    }

    if (withdrawal.gt(0)) {
      if (!ownOpen) {
        throw new SaleReversalError(
          `Abra o seu caixa para devolver ${formatCurrency(withdrawal.toNumber())} em dinheiro.`,
        );
      }
      const { expectedCash } = await computeCashSummary(tx, ownOpen.id);
      if (withdrawal.gt(expectedCash)) {
        throw new SaleReversalError(
          "Dinheiro insuficiente no seu caixa para devolver o valor do estorno.",
        );
      }
    }

    // Marca a venda; a condição em reversedAt garante um único estorno mesmo sob concorrência
    const claimed = await tx.sale.updateMany({
      where: { id: sale.id, reversedAt: null },
      data: {
        reversedAt: new Date(),
        reversedById: userId,
        reversalReason: reason,
        reversedInRegister,
      },
    });
    if (claimed.count === 0) throw new SaleReversalError("Esta venda já foi estornada.");

    if (sale.receivable) {
      // Guarda otimista, como no recebimento: um recebimento concorrente desfaz o estorno
      const canceled = await tx.receivable.updateMany({
        where: {
          id: sale.receivable.id,
          paidAmount: sale.receivable.paidAmount,
          status: { not: ReceivableStatus.CANCELED },
        },
        data: { status: ReceivableStatus.CANCELED },
      });
      if (canceled.count === 0) {
        throw new SaleReversalError("O título do Fiado mudou, recarregue e tente novamente.");
      }
    }

    for (const item of sale.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { currentStock: { increment: item.quantity } },
      });
    }
    await tx.stockMovement.createMany({
      data: sale.items.map((item) => ({
        productId: item.productId,
        type: MovementType.IN,
        quantity: item.quantity,
        reason: label,
        userId,
      })),
    });

    if (withdrawal.gt(0) && ownOpen) {
      await tx.cashMovement.create({
        data: {
          cashRegisterId: ownOpen.id,
          type: CashMovementType.WITHDRAWAL,
          amount: withdrawal,
          reason: label,
          userId,
          saleId: sale.id,
        },
      });
    }

    const cashRefund = reversedInRegister ? sale.total : withdrawal;
    return {
      code: sale.code,
      cashRefund: cashRefund.toNumber(),
      cashRefundFrom: reversedInRegister
        ? ("SALE_REGISTER" as const)
        : withdrawal.gt(0)
          ? ("OWN_REGISTER" as const)
          : null,
    };
  });
}

export async function reverseSale(
  userId: string,
  data: ReverseSaleInput,
): Promise<ReverseSaleResult> {
  try {
    if (typeof data?.saleId !== "string" || !data.saleId) {
      return { success: false, error: "Venda não informada." };
    }
    const reason = readReason(data.reason);
    return { success: true, data: await persistReversal(userId, data.saleId, reason) };
  } catch (error) {
    if (error instanceof SaleReversalError) {
      return { success: false, error: error.message };
    }
    console.error("Erro ao estornar venda:", error);
    return { success: false, error: "Falha ao estornar a venda no banco de dados." };
  }
}
