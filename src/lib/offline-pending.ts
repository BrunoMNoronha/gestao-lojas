import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/authz";
import { parseOperationId } from "@/lib/sync-operation";

// Vendas guardadas nos aparelhos e ainda não gravadas no servidor (issue #38, docs/OFFLINE.md
// seção 3.3). O aparelho informa, por autorização offline, quantas vendas dela ainda não chegaram;
// o fechamento do caixa avisa quando algum aparelho preparado para ele ainda tem vendas. É só um
// aviso: o servidor não tem como saber das vendas de um aparelho que não voltou a se conectar.

const MAX_GRANTS_PER_REPORT = 50;
const MAX_PENDING = 100_000;

/** Informe inválido enviado pelo aparelho (o Route Handler responde 400). */
export class PendingReportError extends Error {}

/**
 * Grava o informe do aparelho: `{ deviceId, grants: [{ grantId, pending }] }`. Só atualiza as
 * autorizações do próprio operador naquele aparelho; as demais são ignoradas.
 */
export async function reportPendingSales(user: SessionUser, raw: unknown) {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const deviceId = parseOperationId(body.deviceId);
  if (!deviceId) throw new PendingReportError("Aparelho inválido.");
  if (!Array.isArray(body.grants) || body.grants.length > MAX_GRANTS_PER_REPORT) {
    throw new PendingReportError("Informe de pendências inválido.");
  }

  const counts = new Map<string, number>();
  for (const item of body.grants) {
    const entry = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const grantId = parseOperationId(entry.grantId);
    const pending = entry.pending;
    if (
      !grantId ||
      typeof pending !== "number" ||
      !Number.isInteger(pending) ||
      pending < 0 ||
      pending > MAX_PENDING
    ) {
      throw new PendingReportError("Informe de pendências inválido.");
    }
    counts.set(grantId, pending);
  }

  const reportedAt = new Date();
  let updated = 0;
  for (const [grantId, pending] of counts) {
    const result = await prisma.offlineGrant.updateMany({
      where: { id: grantId, userId: user.id, deviceId },
      data: { pendingCount: pending, pendingReportedAt: reportedAt },
    });
    updated += result.count;
  }
  return { updated };
}

/** Sem informe há mais que isto: o aparelho pode estar sem internet com vendas guardadas. */
export const STALE_REPORT_MS = 10 * 60 * 1000;

export interface OfflineDevicePending {
  deviceId: string;
  deviceName: string;
  userName: string;
  // never: nunca informou depois da preparação; pending: tinha vendas no último informe;
  // stale: sem informe há mais de 10 minutos (o /pdv aberto com conexão informa a cada 2 min)
  status: "never" | "pending" | "stale";
  // Vendas ainda não enviadas no último informe (null se nunca informou)
  pending: number | null;
  reportedAt: string | null;
}

/**
 * Aparelhos preparados para o caixa (e não revogados) que podem ter vendas dele ainda não
 * enviadas: nunca informaram, tinham vendas no último informe ou estão sem contato.
 */
export async function offlinePendingForCashRegister(
  cashRegisterId: string,
  now: Date = new Date(),
): Promise<OfflineDevicePending[]> {
  const grants = await prisma.offlineGrant.findMany({
    where: { cashRegisterId, device: { revokedAt: null } },
    orderBy: { issuedAt: "desc" },
    select: {
      deviceId: true,
      pendingCount: true,
      pendingReportedAt: true,
      device: { select: { name: true } },
      user: { select: { name: true } },
    },
  });

  const byDevice = new Map<
    string,
    { deviceName: string; userName: string; pending: number | null; reportedAt: Date | null }
  >();
  for (const grant of grants) {
    // A primeira linha de cada aparelho é a autorização mais recente (nome do operador atual)
    const entry = byDevice.get(grant.deviceId) ?? {
      deviceName: grant.device.name,
      userName: grant.user.name,
      pending: null,
      reportedAt: null,
    };
    byDevice.set(grant.deviceId, entry);
    if (grant.pendingReportedAt) {
      entry.pending = (entry.pending ?? 0) + (grant.pendingCount ?? 0);
      if (!entry.reportedAt || grant.pendingReportedAt > entry.reportedAt) {
        entry.reportedAt = grant.pendingReportedAt;
      }
    }
  }

  const result: OfflineDevicePending[] = [];
  for (const [deviceId, d] of byDevice) {
    const status = !d.reportedAt
      ? "never"
      : (d.pending ?? 0) > 0
        ? "pending"
        : now.getTime() - d.reportedAt.getTime() > STALE_REPORT_MS
          ? "stale"
          : null;
    if (!status) continue;
    result.push({
      deviceId,
      deviceName: d.deviceName,
      userName: d.userName,
      status,
      pending: d.pending,
      reportedAt: d.reportedAt?.toISOString() ?? null,
    });
  }
  return result;
}
