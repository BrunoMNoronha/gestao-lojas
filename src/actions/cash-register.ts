"use server";

import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { CashMovementType, CashRegisterStatus, Prisma } from "@prisma/client";
import {
  CashRegisterSummary,
  computeCashSummary,
  lockOpenCashRegister,
  parseMoney,
} from "@/lib/cash-register";
import type { PaymentMethodValue } from "@/lib/payments";

export type CashMovementTypeValue = "SUPPLY" | "WITHDRAWAL";

export interface CurrentCashRegister {
  id: string;
  userName: string;
  openedAt: string;
  summary: CashRegisterSummary;
}

export interface CashRegisterHistoryItem {
  id: string;
  userId: string;
  userName: string;
  openedAt: string;
  closedAt: string | null;
  openingAmount: number;
  expectedAmount: number | null;
  countedAmount: number | null;
  difference: number | null;
  closingNote: string | null;
}

export interface CashRegisterHistoryFilters {
  userId?: string | null;
  // Limites em ISO 8601, calculados no navegador a partir do dia local do usuário
  from?: string | null;
  to?: string | null;
  take?: number;
  skip?: number;
}

export interface CashRegisterDetail extends CashRegisterHistoryItem {
  status: "OPEN" | "CLOSED";
  summary: CashRegisterSummary;
  movements: {
    id: string;
    type: CashMovementTypeValue;
    amount: number;
    reason: string;
    userName: string;
    createdAt: string;
  }[];
  receivablePayments: {
    id: string;
    amount: number;
    method: PaymentMethodValue;
    customerName: string;
    saleCode: number;
    createdAt: string;
  }[];
}

export interface CashOperator {
  id: string;
  name: string;
}

const MAX_TEXT_LENGTH = 200;
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

// Erro de regra de negócio: a mensagem é segura para exibir ao operador.
class CashRegisterValidationError extends Error {}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function revalidateCashPaths() {
  revalidatePath("/admin/caixa");
  revalidatePath("/admin/pdv");
  revalidatePath("/admin/contas-a-receber");
}

function toHistoryItem(r: {
  id: string;
  userId: string;
  user: { name: string };
  openedAt: Date;
  closedAt: Date | null;
  openingAmount: Prisma.Decimal;
  expectedAmount: Prisma.Decimal | null;
  countedAmount: Prisma.Decimal | null;
  difference: Prisma.Decimal | null;
  closingNote: string | null;
}): CashRegisterHistoryItem {
  return {
    id: r.id,
    userId: r.userId,
    userName: r.user.name,
    openedAt: r.openedAt.toISOString(),
    closedAt: r.closedAt?.toISOString() ?? null,
    openingAmount: r.openingAmount.toNumber(),
    expectedAmount: r.expectedAmount?.toNumber() ?? null,
    countedAmount: r.countedAmount?.toNumber() ?? null,
    difference: r.difference?.toNumber() ?? null,
    closingNote: r.closingNote,
  };
}

// Sem try/catch de propósito: em falha do banco a página deve mostrar o fallback de erro,
// e não o formulário de abertura como se não houvesse caixa aberto.
export async function getCurrentCashRegister(): Promise<CurrentCashRegister | null> {
  const authz = await authorize("cash.own");
  if (!authz.ok) return null;
  const userId = authz.user.id;

  const register = await prisma.cashRegister.findUnique({
    where: { openUserId: userId },
    include: { user: { select: { name: true } } },
  });
  if (!register) return null;

  const { summary } = await computeCashSummary(prisma, register.id);
  return {
    id: register.id,
    userName: register.user.name,
    openedAt: register.openedAt.toISOString(),
    summary,
  };
}

export async function openCashRegister(data: { openingAmount: number }) {
  try {
    const authz = await authorize("cash.own");
    if (!authz.ok) {
      return { success: false, error: authz.error };
    }
    const userId = authz.user.id;

    const openingAmount = parseMoney(data?.openingAmount, { allowZero: true });
    if (!openingAmount) {
      return { success: false, error: "Informe um valor de abertura válido (zero ou mais)." };
    }

    const existing = await prisma.cashRegister.findUnique({
      where: { openUserId: userId },
      select: { id: true },
    });
    if (existing) {
      return { success: false, error: "Você já possui um caixa aberto." };
    }

    await prisma.cashRegister.create({
      data: { userId, openUserId: userId, openingAmount },
    });

    revalidateCashPaths();
    return { success: true };
  } catch (error) {
    // Abertura simultânea: a unicidade de openUserId barra o segundo caixa
    if (isUniqueViolation(error)) {
      return { success: false, error: "Você já possui um caixa aberto." };
    }
    console.error("Erro ao abrir o caixa:", error);
    return { success: false, error: "Falha ao abrir o caixa no banco de dados." };
  }
}

export async function registerCashMovement(data: {
  type: CashMovementTypeValue;
  amount: number;
  reason: string;
}) {
  try {
    const authz = await authorize("cash.own");
    if (!authz.ok) {
      return { success: false, error: authz.error };
    }
    const userId = authz.user.id;

    if (!Object.values(CashMovementType).includes(data?.type as CashMovementType)) {
      return { success: false, error: "Tipo de movimentação inválido." };
    }
    const amount = parseMoney(data.amount, { allowZero: false });
    if (!amount) {
      return { success: false, error: "Informe um valor maior que zero." };
    }
    const reason = typeof data.reason === "string" ? data.reason.trim() : "";
    if (!reason) {
      return { success: false, error: "Informe o motivo da movimentação." };
    }
    if (reason.length > MAX_TEXT_LENGTH) {
      return { success: false, error: `O motivo deve ter até ${MAX_TEXT_LENGTH} caracteres.` };
    }

    await prisma.$transaction(async (tx) => {
      const register = await lockOpenCashRegister(tx, userId);
      if (!register) {
        throw new CashRegisterValidationError("Abra o caixa antes de registrar movimentações.");
      }

      if (data.type === CashMovementType.WITHDRAWAL) {
        const { expectedCash } = await computeCashSummary(tx, register.id);
        if (amount.gt(expectedCash)) {
          throw new CashRegisterValidationError(
            "A sangria não pode ser maior que o dinheiro disponível no caixa.",
          );
        }
      }

      await tx.cashMovement.create({
        data: {
          cashRegisterId: register.id,
          type: data.type,
          amount,
          reason,
          userId,
        },
      });
    });

    revalidateCashPaths();
    return { success: true };
  } catch (error) {
    if (error instanceof CashRegisterValidationError) {
      return { success: false, error: error.message };
    }
    console.error("Erro ao registrar movimentação de caixa:", error);
    return { success: false, error: "Falha ao registrar a movimentação no banco de dados." };
  }
}

export async function closeCashRegister(data: { countedAmount: number; note?: string | null }) {
  try {
    const authz = await authorize("cash.own");
    if (!authz.ok) {
      return { success: false, error: authz.error };
    }
    const userId = authz.user.id;

    const countedAmount = parseMoney(data?.countedAmount, { allowZero: true });
    if (!countedAmount) {
      return { success: false, error: "Informe o valor contado (zero ou mais)." };
    }
    const note = typeof data.note === "string" ? data.note.trim() : "";
    if (note.length > MAX_TEXT_LENGTH) {
      return {
        success: false,
        error: `A observação deve ter até ${MAX_TEXT_LENGTH} caracteres.`,
      };
    }

    const closed = await prisma.$transaction(async (tx) => {
      const register = await lockOpenCashRegister(tx, userId);
      if (!register) {
        throw new CashRegisterValidationError("Não há caixa aberto para fechar.");
      }

      const { expectedCash } = await computeCashSummary(tx, register.id);
      const difference = countedAmount.sub(expectedCash);
      if (!difference.isZero() && !note) {
        throw new CashRegisterValidationError(
          "Há diferença entre o contado e o esperado. Informe uma observação.",
        );
      }

      return tx.cashRegister.update({
        where: { id: register.id },
        data: {
          status: CashRegisterStatus.CLOSED,
          openUserId: null,
          closedAt: new Date(),
          expectedAmount: expectedCash,
          countedAmount,
          difference,
          closingNote: note || null,
        },
      });
    });

    revalidateCashPaths();
    return {
      success: true,
      data: {
        id: closed.id,
        expectedAmount: closed.expectedAmount?.toNumber() ?? 0,
        countedAmount: closed.countedAmount?.toNumber() ?? 0,
        difference: closed.difference?.toNumber() ?? 0,
      },
    };
  } catch (error) {
    if (error instanceof CashRegisterValidationError) {
      return { success: false, error: error.message };
    }
    console.error("Erro ao fechar o caixa:", error);
    return { success: false, error: "Falha ao fechar o caixa no banco de dados." };
  }
}

export async function getCashRegisterHistory(
  filters: CashRegisterHistoryFilters = {},
): Promise<{ items: CashRegisterHistoryItem[]; total: number }> {
  try {
    const authz = await authorize("cash.own");
    if (!authz.ok) return { items: [], total: 0 };

    const where: Prisma.CashRegisterWhereInput = { status: CashRegisterStatus.CLOSED };
    // Sem cash.viewOthers (vendedor), o histórico fica restrito aos próprios turnos
    if (!can(authz.user.role, "cash.viewOthers")) where.userId = authz.user.id;
    else if (filters.userId) where.userId = filters.userId;
    const from = parseDate(filters.from);
    const to = parseDate(filters.to);
    if (from || to) {
      where.closedAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const take = Math.min(
      Math.max(Math.trunc(filters.take ?? DEFAULT_PAGE_SIZE), 1),
      MAX_PAGE_SIZE,
    );
    const skip = Math.max(Math.trunc(filters.skip ?? 0), 0);

    const [registers, total] = await Promise.all([
      prisma.cashRegister.findMany({
        where,
        include: { user: { select: { name: true } } },
        orderBy: [{ closedAt: "desc" }, { id: "desc" }],
        take,
        skip,
      }),
      prisma.cashRegister.count({ where }),
    ]);

    return { items: registers.map(toHistoryItem), total };
  } catch (error) {
    console.error("Erro ao buscar histórico de caixas:", error);
    return { items: [], total: 0 };
  }
}

export async function getCashRegisterDetail(id: string): Promise<CashRegisterDetail | null> {
  try {
    const authz = await authorize("cash.own");
    if (!authz.ok || typeof id !== "string" || !id) return null;

    const register = await prisma.cashRegister.findUnique({
      where: { id },
      include: {
        user: { select: { name: true } },
        movements: {
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        },
        receivablePayments: {
          include: {
            receivable: {
              select: {
                customer: { select: { name: true } },
                sale: { select: { code: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!register) return null;
    if (!can(authz.user.role, "cash.viewOthers") && register.userId !== authz.user.id) {
      return null;
    }

    const { summary } = await computeCashSummary(prisma, register.id);

    return {
      ...toHistoryItem(register),
      status: register.status,
      summary,
      movements: register.movements.map((m) => ({
        id: m.id,
        type: m.type,
        amount: m.amount.toNumber(),
        reason: m.reason,
        userName: m.user.name,
        createdAt: m.createdAt.toISOString(),
      })),
      receivablePayments: register.receivablePayments.map((p) => ({
        id: p.id,
        amount: p.amount.toNumber(),
        method: p.method as PaymentMethodValue,
        customerName: p.receivable.customer.name,
        saleCode: p.receivable.sale.code,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  } catch (error) {
    console.error("Erro ao buscar detalhe do caixa:", error);
    return null;
  }
}

export async function getCashOperators(): Promise<CashOperator[]> {
  try {
    const authz = await authorize("cash.own");
    if (!authz.ok) return [];

    if (!can(authz.user.role, "cash.viewOthers")) {
      return [{ id: authz.user.id, name: authz.user.name }];
    }

    return await prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  } catch (error) {
    console.error("Erro ao buscar operadores:", error);
    return [];
  }
}
