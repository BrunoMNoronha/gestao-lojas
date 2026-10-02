import { CashMovementType, CashRegisterStatus, PaymentMethod, Prisma } from "@prisma/client";
import type { PaymentMethodValue } from "@/lib/payments";

// Usado apenas no servidor (Server Actions). Os valores monetários são sempre somados em
// Prisma.Decimal e só convertidos para number na serialização para o cliente.

type Db = Prisma.TransactionClient;

export const MAX_MONEY = 1_000_000;

export interface MethodTotal {
  method: PaymentMethodValue;
  total: number;
  count: number;
}

export interface CashRegisterSummary {
  openingAmount: number;
  salesByMethod: MethodTotal[];
  salesCount: number;
  salesTotal: number;
  supplies: number;
  withdrawals: number;
  receivedByMethod: MethodTotal[];
  receivedCash: number;
  expectedCash: number;
}

/**
 * Trava a linha do caixa aberto do operador até o fim da transação (UPDATE sem efeito) e
 * devolve o caixa. Vendas, sangrias, recebimentos e o fechamento passam por aqui, então
 * ficam serializados por caixa: um fechamento nunca perde uma venda concorrente, e uma
 * venda iniciada após o fechamento não encontra mais o caixa aberto.
 */
export async function lockOpenCashRegister(tx: Db, userId: string) {
  const locked = await tx.cashRegister.updateMany({
    where: { openUserId: userId, status: CashRegisterStatus.OPEN },
    data: { status: CashRegisterStatus.OPEN },
  });
  if (locked.count === 0) return null;
  return tx.cashRegister.findUnique({ where: { openUserId: userId } });
}

/**
 * Regra única do dinheiro esperado na gaveta:
 * abertura + vendas em dinheiro + suprimentos − sangrias + recebimentos de fiado em dinheiro.
 * O troco sai da própria gaveta, por isso conta o total da venda (não o valor recebido).
 */
export async function computeCashSummary(tx: Db, cashRegisterId: string) {
  const register = await tx.cashRegister.findUniqueOrThrow({
    where: { id: cashRegisterId },
    select: { openingAmount: true },
  });

  const [sales, movements, received] = await Promise.all([
    tx.sale.groupBy({
      by: ["paymentMethod"],
      where: { cashRegisterId },
      _sum: { total: true },
      _count: { _all: true },
    }),
    tx.cashMovement.groupBy({
      by: ["type"],
      where: { cashRegisterId },
      _sum: { amount: true },
    }),
    tx.receivablePayment.groupBy({
      by: ["method"],
      where: { cashRegisterId },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const zero = new Prisma.Decimal(0);
  const salesCash = sales.find((s) => s.paymentMethod === PaymentMethod.MONEY)?._sum.total ?? zero;
  const supplies = movements.find((m) => m.type === CashMovementType.SUPPLY)?._sum.amount ?? zero;
  const withdrawals =
    movements.find((m) => m.type === CashMovementType.WITHDRAWAL)?._sum.amount ?? zero;
  const receivedCash = received.find((r) => r.method === PaymentMethod.MONEY)?._sum.amount ?? zero;
  const salesTotal = sales.reduce((sum, s) => sum.add(s._sum.total ?? zero), zero);

  const expectedCash = register.openingAmount
    .add(salesCash)
    .add(supplies)
    .sub(withdrawals)
    .add(receivedCash);

  const summary: CashRegisterSummary = {
    openingAmount: register.openingAmount.toNumber(),
    salesByMethod: sales.map((s) => ({
      method: s.paymentMethod as PaymentMethodValue,
      total: (s._sum.total ?? zero).toNumber(),
      count: s._count._all,
    })),
    salesCount: sales.reduce((sum, s) => sum + s._count._all, 0),
    salesTotal: salesTotal.toNumber(),
    supplies: supplies.toNumber(),
    withdrawals: withdrawals.toNumber(),
    receivedByMethod: received.map((r) => ({
      method: r.method as PaymentMethodValue,
      total: (r._sum.amount ?? zero).toNumber(),
      count: r._count._all,
    })),
    receivedCash: receivedCash.toNumber(),
    expectedCash: expectedCash.toNumber(),
  };

  return { expectedCash, summary };
}

/** Converte um valor monetário vindo do cliente; devolve null se inválido. */
export function parseMoney(
  value: unknown,
  { allowZero }: { allowZero: boolean },
): Prisma.Decimal | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > MAX_MONEY) return null;
  const amount = new Prisma.Decimal(value).toDecimalPlaces(2);
  if (!allowZero && amount.lte(0)) return null;
  return amount;
}
