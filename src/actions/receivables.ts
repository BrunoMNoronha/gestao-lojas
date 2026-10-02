"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { PaymentMethod, Prisma, ReceivableStatus } from "@prisma/client";
import { lockOpenCashRegister, parseMoney } from "@/lib/cash-register";
import type { PaymentMethodValue } from "@/lib/payments";

export type ReceivableStatusValue = "OPEN" | "PARTIAL" | "PAID";

export interface ReceivableItem {
  id: string;
  customerId: string;
  customerName: string;
  saleCode: number;
  saleDate: string;
  amount: number;
  paidAmount: number;
  balance: number;
  status: ReceivableStatusValue;
  dueDate: string | null;
  payments: {
    id: string;
    amount: number;
    method: PaymentMethodValue;
    userName: string;
    createdAt: string;
  }[];
}

export interface ReceivableFilters {
  customerId?: string | null;
  status?: ReceivableStatusValue | null;
  take?: number;
  skip?: number;
}

export interface ReceivablesSummary {
  openTotal: number;
  openCount: number;
  debtorCount: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

// Erro de regra de negócio: a mensagem é segura para exibir ao operador.
class ReceivableValidationError extends Error {}

export async function getReceivables(
  filters: ReceivableFilters = {},
): Promise<{ items: ReceivableItem[]; total: number }> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { items: [], total: 0 };

    const where: Prisma.ReceivableWhereInput = {};
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.status && Object.values(ReceivableStatus).includes(filters.status)) {
      where.status = filters.status;
    }

    const take = Math.min(
      Math.max(Math.trunc(filters.take ?? DEFAULT_PAGE_SIZE), 1),
      MAX_PAGE_SIZE,
    );
    const skip = Math.max(Math.trunc(filters.skip ?? 0), 0);

    const [receivables, total] = await Promise.all([
      prisma.receivable.findMany({
        where,
        include: {
          customer: { select: { name: true } },
          sale: { select: { code: true, createdAt: true } },
          payments: {
            include: { user: { select: { name: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
        // Ordem do enum: OPEN, PARTIAL, PAID → títulos em aberto primeiro, mais antigos antes
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        take,
        skip,
      }),
      prisma.receivable.count({ where }),
    ]);

    return {
      items: receivables.map((r) => ({
        id: r.id,
        customerId: r.customerId,
        customerName: r.customer.name,
        saleCode: r.sale.code,
        saleDate: r.sale.createdAt.toISOString(),
        amount: r.amount.toNumber(),
        paidAmount: r.paidAmount.toNumber(),
        balance: r.amount.sub(r.paidAmount).toNumber(),
        status: r.status,
        dueDate: r.dueDate?.toISOString() ?? null,
        payments: r.payments.map((p) => ({
          id: p.id,
          amount: p.amount.toNumber(),
          method: p.method as PaymentMethodValue,
          userName: p.user.name,
          createdAt: p.createdAt.toISOString(),
        })),
      })),
      total,
    };
  } catch (error) {
    console.error("Erro ao buscar contas a receber:", error);
    return { items: [], total: 0 };
  }
}

export async function getReceivablesSummary(): Promise<ReceivablesSummary> {
  const empty = { openTotal: 0, openCount: 0, debtorCount: 0 };
  try {
    const session = await auth();
    if (!session?.user?.id) return empty;

    const where = { status: { not: ReceivableStatus.PAID } };
    const [totals, debtors] = await Promise.all([
      prisma.receivable.aggregate({
        where,
        _sum: { amount: true, paidAmount: true },
        _count: { _all: true },
      }),
      prisma.receivable.groupBy({ by: ["customerId"], where }),
    ]);

    const amount = totals._sum.amount ?? new Prisma.Decimal(0);
    const paid = totals._sum.paidAmount ?? new Prisma.Decimal(0);
    return {
      openTotal: amount.sub(paid).toNumber(),
      openCount: totals._count._all,
      debtorCount: debtors.length,
    };
  } catch (error) {
    console.error("Erro ao resumir contas a receber:", error);
    return empty;
  }
}

export async function registerReceivablePayment(data: {
  receivableId: string;
  amount: number;
  method: PaymentMethodValue;
}) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return { success: false, error: "Sessão expirada. Faça login novamente." };
    }

    if (typeof data?.receivableId !== "string" || !data.receivableId) {
      return { success: false, error: "Título não informado." };
    }
    if (
      !Object.values(PaymentMethod).includes(data.method as PaymentMethod) ||
      data.method === PaymentMethod.ON_ACCOUNT
    ) {
      return { success: false, error: "Forma de recebimento inválida." };
    }
    const amount = parseMoney(data.amount, { allowZero: false });
    if (!amount) {
      return { success: false, error: "Informe um valor de recebimento maior que zero." };
    }

    await prisma.$transaction(async (tx) => {
      // Recebimento em dinheiro entra na gaveta: exige caixa aberto. Nas demais formas o
      // vínculo é registrado quando houver caixa aberto, para aparecer no resumo do turno.
      const register = await lockOpenCashRegister(tx, userId);
      if (data.method === PaymentMethod.MONEY && !register) {
        throw new ReceivableValidationError("Abra o caixa antes de receber em dinheiro.");
      }

      const receivable = await tx.receivable.findUnique({
        where: { id: data.receivableId },
        select: { id: true, amount: true, paidAmount: true },
      });
      if (!receivable) {
        throw new ReceivableValidationError("Título não encontrado. Atualize a tela.");
      }

      const balance = receivable.amount.sub(receivable.paidAmount);
      if (balance.lte(0)) {
        throw new ReceivableValidationError("Este título já está quitado.");
      }
      if (amount.gt(balance)) {
        throw new ReceivableValidationError(
          "O valor recebido não pode ser maior que o saldo devedor.",
        );
      }

      const newPaid = receivable.paidAmount.add(amount);
      const status = newPaid.gte(receivable.amount)
        ? ReceivableStatus.PAID
        : ReceivableStatus.PARTIAL;

      // Guarda otimista: só grava se nenhum outro recebimento alterou o título
      const updated = await tx.receivable.updateMany({
        where: { id: receivable.id, paidAmount: receivable.paidAmount },
        data: { paidAmount: newPaid, status },
      });
      if (updated.count === 0) {
        throw new ReceivableValidationError("O título mudou, recarregue e tente novamente.");
      }

      await tx.receivablePayment.create({
        data: {
          receivableId: receivable.id,
          amount,
          method: data.method,
          userId,
          cashRegisterId: register?.id ?? null,
        },
      });
    });

    revalidatePath("/admin/contas-a-receber");
    revalidatePath("/admin/caixa");
    return { success: true };
  } catch (error) {
    if (error instanceof ReceivableValidationError) {
      return { success: false, error: error.message };
    }
    console.error("Erro ao registrar recebimento:", error);
    return { success: false, error: "Falha ao registrar o recebimento no banco de dados." };
  }
}
