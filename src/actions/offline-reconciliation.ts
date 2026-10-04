"use server";

import { revalidatePath } from "next/cache";
import {
  Prisma,
  SyncOperationStatus,
  type PaymentMethod,
  type ReconciliationIssueType,
  type SyncConflictReason,
} from "@prisma/client";
import { authorize } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import {
  acknowledgeIssue,
  approveConflict,
  discardConflict,
  OFFLINE_SALE_PATHS,
} from "@/lib/offline-sale";

// Conciliação das vendas offline (issue #38, docs/OFFLINE.md seção 4): conflitos (vendas não
// aplicadas, aguardando aprovação ou descarte) e pendências (vendas aplicadas que exigem
// acompanhamento). Tudo exige "offline.reconcile" (ADMIN e MANAGER). As regras ficam em
// src/lib/offline-sale.ts; a tela é da etapa seguinte da #38.

const PAGE_SIZE = 50;
const RECONCILIATION_PATH = "/admin/sincronizacao";

export interface OfflineConflictItem {
  operationId: string;
  status: SyncOperationStatus;
  userName: string;
  deviceName: string | null;
  cashRegisterId: string | null;
  occurredAt: string;
  receivedAt: string;
  reason: SyncConflictReason | null;
  message: string | null;
  paymentMethod: PaymentMethod | null;
  total: number | null;
  items: { productId: string; productName: string; quantity: number; unitPrice: number }[];
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  saleCode: number | null;
}

export interface ReconciliationIssueItem {
  id: string;
  type: ReconciliationIssueType;
  saleId: string;
  saleCode: number;
  saleOccurredAt: string;
  userName: string;
  productName: string | null;
  details: Record<string, string | null>;
  createdAt: string;
  acknowledgedByName: string | null;
  acknowledgedAt: string | null;
  note: string | null;
}

export type ListResult<T> =
  { success: true; data: T[]; hasMore: boolean } | { success: false; error: string };

function pageOf(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : 1;
}

type StoredItem = [string, string, string];

/** Itens e total do payload guardado (valores como texto no payload canônico). */
function summarize(payload: Prisma.JsonValue) {
  const sale = (payload ?? {}) as {
    items?: StoredItem[];
    discount?: string;
    paymentMethod?: PaymentMethod;
  };
  const items = Array.isArray(sale.items) ? sale.items : [];
  let subtotal = new Prisma.Decimal(0);
  for (const [, quantity, price] of items) {
    subtotal = subtotal.add(new Prisma.Decimal(quantity).mul(price).toDecimalPlaces(2));
  }
  const discount = new Prisma.Decimal(sale.discount ?? 0);
  return {
    items,
    paymentMethod: sale.paymentMethod ?? null,
    total: items.length ? subtotal.sub(discount).toNumber() : null,
  };
}

/** Conflitos das vendas offline: em aberto (padrão) ou já resolvidos. */
export async function listOfflineConflicts(
  options: { resolved?: boolean; page?: number } = {},
): Promise<ListResult<OfflineConflictItem>> {
  try {
    const authz = await authorize("offline.reconcile");
    if (!authz.ok) return { success: false, error: authz.error };

    const page = pageOf(options.page);
    const rows = await prisma.syncOperation.findMany({
      where: options.resolved
        ? {
            status: { in: [SyncOperationStatus.APPROVED, SyncOperationStatus.DISCARDED] },
          }
        : { status: SyncOperationStatus.CONFLICT },
      orderBy: options.resolved
        ? [{ resolvedAt: "desc" }, { id: "asc" }]
        : [{ receivedAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      include: {
        user: { select: { name: true } },
        device: { select: { name: true } },
        resolvedBy: { select: { name: true } },
        sale: { select: { code: true } },
      },
    });
    const visible = rows.slice(0, PAGE_SIZE);

    const summaries = visible.map((row) => summarize(row.payload));
    const productIds = [...new Set(summaries.flatMap((s) => s.items.map(([id]) => id)))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true },
    });
    const names = new Map(products.map((p) => [p.id, p.name]));

    return {
      success: true,
      hasMore: rows.length > PAGE_SIZE,
      data: visible.map((row, index) => {
        const summary = summaries[index];
        return {
          operationId: row.id,
          status: row.status,
          userName: row.user.name,
          deviceName: row.device?.name ?? null,
          cashRegisterId: row.cashRegisterId,
          occurredAt: row.occurredAt.toISOString(),
          receivedAt: row.receivedAt.toISOString(),
          reason: row.conflictReason,
          message: row.conflictMessage,
          paymentMethod: summary.paymentMethod,
          total: summary.total,
          items: summary.items.map(([productId, quantity, price]) => ({
            productId,
            productName: names.get(productId) ?? "Produto não encontrado",
            quantity: Number(quantity),
            unitPrice: Number(price),
          })),
          resolvedByName: row.resolvedBy?.name ?? null,
          resolvedAt: row.resolvedAt?.toISOString() ?? null,
          resolutionNote: row.resolutionNote,
          saleCode: row.sale?.code ?? null,
        };
      }),
    };
  } catch (error) {
    console.error("Erro ao listar conflitos offline:", error);
    return { success: false, error: "Não foi possível carregar os conflitos agora." };
  }
}

/** Pendências de conciliação: sem ciência (padrão) ou já conferidas. */
export async function listReconciliationIssues(
  options: { acknowledged?: boolean; page?: number } = {},
): Promise<ListResult<ReconciliationIssueItem>> {
  try {
    const authz = await authorize("offline.reconcile");
    if (!authz.ok) return { success: false, error: authz.error };

    const page = pageOf(options.page);
    const rows = await prisma.reconciliationIssue.findMany({
      where: { acknowledgedAt: options.acknowledged ? { not: null } : null },
      orderBy: options.acknowledged
        ? [{ acknowledgedAt: "desc" }, { id: "asc" }]
        : [{ createdAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      include: {
        sale: { select: { code: true, occurredAt: true, user: { select: { name: true } } } },
        product: { select: { name: true } },
        acknowledgedBy: { select: { name: true } },
      },
    });

    return {
      success: true,
      hasMore: rows.length > PAGE_SIZE,
      data: rows.slice(0, PAGE_SIZE).map((row) => ({
        id: row.id,
        type: row.type,
        saleId: row.saleId,
        saleCode: row.sale.code,
        saleOccurredAt: row.sale.occurredAt.toISOString(),
        userName: row.sale.user.name,
        productName: row.product?.name ?? null,
        details: row.details as Record<string, string | null>,
        createdAt: row.createdAt.toISOString(),
        acknowledgedByName: row.acknowledgedBy?.name ?? null,
        acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
        note: row.note,
      })),
    };
  } catch (error) {
    console.error("Erro ao listar pendências de conciliação:", error);
    return { success: false, error: "Não foi possível carregar as pendências agora." };
  }
}

/** Aprova o conflito: a venda é gravada com a autoria e o caixa originais. */
export async function approveOfflineConflict(operationId: string, note?: string) {
  try {
    const authz = await authorize("offline.reconcile");
    if (!authz.ok) return { success: false, error: authz.error };

    const result = await approveConflict(authz.user, operationId, note);
    if (result.success) {
      for (const path of OFFLINE_SALE_PATHS) revalidatePath(path);
      revalidatePath(RECONCILIATION_PATH);
    }
    return result;
  } catch (error) {
    console.error("Erro ao aprovar conflito offline:", error);
    return { success: false, error: "Não foi possível aprovar agora. Tente novamente." };
  }
}

/** Descarta o conflito com motivo: nenhuma venda é gravada. */
export async function discardOfflineConflict(operationId: string, note: string) {
  try {
    const authz = await authorize("offline.reconcile");
    if (!authz.ok) return { success: false, error: authz.error };

    const result = await discardConflict(authz.user, operationId, note);
    if (result.success) revalidatePath(RECONCILIATION_PATH);
    return result;
  } catch (error) {
    console.error("Erro ao descartar conflito offline:", error);
    return { success: false, error: "Não foi possível descartar agora. Tente novamente." };
  }
}

/** Registra a ciência de uma pendência de conciliação. */
export async function acknowledgeReconciliationIssue(issueId: string, note?: string) {
  try {
    const authz = await authorize("offline.reconcile");
    if (!authz.ok) return { success: false, error: authz.error };

    const result = await acknowledgeIssue(authz.user, issueId, note);
    if (result.success) revalidatePath(RECONCILIATION_PATH);
    return result;
  } catch (error) {
    console.error("Erro ao registrar ciência da pendência:", error);
    return { success: false, error: "Não foi possível registrar agora. Tente novamente." };
  }
}
