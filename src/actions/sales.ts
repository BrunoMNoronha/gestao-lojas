"use server";

import { authorize } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { invalidateCatalog } from "@/lib/catalog-cache";
import { revalidatePath } from "next/cache";
import {
  registerSale,
  SALE_RECEIPT_INCLUDE,
  toSaleReceiptBase,
  type CreateSaleInput,
  type SaleReceipt,
} from "@/lib/create-sale";
import type { PaymentMethodValue } from "@/lib/payments";

export interface SaleDetail extends Omit<SaleReceipt, "amountPaid" | "change" | "items"> {
  // Não gravados na venda (só existem no momento de vender)
  amountPaid: null;
  change: null;
  items: (SaleReceipt["items"][number] & { productDeleted: boolean })[];
  cashRegister: { userName: string; openedAt: string; closedAt: string | null } | null;
  receivable: {
    status: "OPEN" | "PARTIAL" | "PAID";
    amount: number;
    paidAmount: number;
    dueDate: string | null;
    payments: {
      id: string;
      amount: number;
      method: PaymentMethodValue;
      userName: string;
      createdAt: string;
    }[];
  } | null;
  // Venda feita num aparelho sem internet e enviada depois (#38)
  offline: {
    deviceName: string;
    receivedAt: string;
    status: "APPLIED" | "CONFLICT" | "APPROVED" | "DISCARDED";
    submittedByName: string | null;
  } | null;
  issues: { id: string; type: string; acknowledged: boolean }[];
}

// As regras da venda (preço, estoque, caixa, Fiado e idempotência pela chave da operação)
// ficam em src/lib/create-sale.ts. Aqui: autorização do operador e revalidação das telas.
export async function createSale(data: CreateSaleInput) {
  try {
    // A venda é sempre atribuída ao operador logado
    const authz = await authorize("pdv.use");
    if (!authz.ok) {
      return { success: false, error: authz.error };
    }

    const result = await registerSale(authz.user.id, data);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Também num reenvio: a resposta original pode ter se perdido antes de atualizar as telas
    revalidatePath("/admin/pdv");
    invalidateCatalog();
    revalidatePath("/admin/produtos");
    revalidatePath("/admin/estoque");
    revalidatePath("/admin/caixa");
    revalidatePath("/admin/contas-a-receber");

    return { success: true, data: result.data };
  } catch (error) {
    console.error("Erro ao registrar venda:", error);
    return { success: false, error: "Falha ao processar a venda no banco de dados." };
  }
}

/**
 * Venda completa para o diálogo de detalhe. Quem tem reports.view vê qualquer venda; os
 * demais, só as que registraram. Venda alheia ou inexistente devolve null (não revela qual).
 */
export async function getSaleDetail(id: string): Promise<SaleDetail | null> {
  try {
    const authz = await authorize("cash.own");
    if (!authz.ok || typeof id !== "string" || !id) return null;

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: {
        ...SALE_RECEIPT_INCLUDE,
        items: {
          include: { product: { select: { name: true, unit: true, deletedAt: true } } },
          orderBy: { id: "asc" },
        },
        cashRegister: {
          select: { openedAt: true, closedAt: true, user: { select: { name: true } } },
        },
        receivable: {
          include: {
            payments: {
              include: { user: { select: { name: true } } },
              orderBy: { createdAt: "asc" },
            },
          },
        },
        syncOperation: {
          select: {
            receivedAt: true,
            status: true,
            device: { select: { name: true } },
            submittedBy: { select: { name: true } },
          },
        },
        reconciliationIssues: {
          select: { id: true, type: true, acknowledgedAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!sale) return null;
    if (!can(authz.user.role, "reports.view") && sale.userId !== authz.user.id) return null;

    const base = toSaleReceiptBase(sale);
    const { receivable, syncOperation, cashRegister } = sale;
    return {
      ...base,
      amountPaid: null,
      change: null,
      items: base.items.map((item, i) => ({
        ...item,
        productDeleted: sale.items[i].product.deletedAt !== null,
      })),
      cashRegister: cashRegister && {
        userName: cashRegister.user.name,
        openedAt: cashRegister.openedAt.toISOString(),
        closedAt: cashRegister.closedAt?.toISOString() ?? null,
      },
      receivable: receivable && {
        status: receivable.status,
        amount: receivable.amount.toNumber(),
        paidAmount: receivable.paidAmount.toNumber(),
        dueDate: receivable.dueDate?.toISOString() ?? null,
        payments: receivable.payments.map((p) => ({
          id: p.id,
          amount: p.amount.toNumber(),
          method: p.method,
          userName: p.user.name,
          createdAt: p.createdAt.toISOString(),
        })),
      },
      // A venda online também tem operação (idempotência), mas sem aparelho
      offline: syncOperation?.device
        ? {
            deviceName: syncOperation.device.name,
            receivedAt: syncOperation.receivedAt.toISOString(),
            status: syncOperation.status,
            submittedByName: syncOperation.submittedBy?.name ?? null,
          }
        : null,
      issues: sale.reconciliationIssues.map((issue) => ({
        id: issue.id,
        type: issue.type,
        acknowledged: issue.acknowledgedAt !== null,
      })),
    };
  } catch (error) {
    console.error("Erro ao buscar detalhe da venda:", error);
    return null;
  }
}
