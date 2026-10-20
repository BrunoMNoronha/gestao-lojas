import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/authz";
import { parseOperationId } from "@/lib/sync-operation";

// Preparação do aparelho para o PDV offline (issue #37, docs/OFFLINE.md seções 3.5 e 7). Usado
// apenas no servidor, pelo Route Handler POST /api/offline/prepare, que autoriza com "pdv.use".
// Registra o aparelho na primeira vez e emite uma autorização offline para o operador, o
// aparelho e o caixa aberto dele. Renovar é preparar de novo.

/** Validade máxima da autorização offline (um turno). */
export const OFFLINE_GRANT_HOURS = 12;
export const DEVICE_NAME_MAX_LENGTH = 80;
const DEFAULT_DEVICE_NAME = "Aparelho sem nome";

/** Recusa da preparação, com o status HTTP e um código estável para a tela do aparelho. */
export class OfflinePrepareError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 409,
    readonly code: "invalid_device" | "device_revoked" | "cash_closed",
  ) {
    super(message);
  }
}

export interface OfflinePreparation {
  device: { id: string; name: string };
  grant: { id: string; issuedAt: string; expiresAt: string; cashRegisterId: string };
  user: SessionUser;
}

function deviceName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().slice(0, DEVICE_NAME_MAX_LENGTH) : "";
  return name || DEFAULT_DEVICE_NAME;
}

/**
 * Prepara o aparelho para o operador já autorizado. `deviceId` é o id recebido numa preparação
 * anterior (ausente na primeira vez, ou desconhecido se o banco do servidor foi recriado: nesses
 * casos o aparelho é registrado de novo). Aparelho revogado não recebe autorização.
 */
export async function prepareOfflineDevice(
  user: SessionUser,
  input: { deviceId?: unknown; deviceName?: unknown },
  now = new Date(),
): Promise<OfflinePreparation> {
  // Mesmo formato do operationId: UUID gerado pelo servidor e guardado no aparelho
  const deviceId =
    input.deviceId === undefined || input.deviceId === null
      ? null
      : parseOperationId(input.deviceId);
  if (input.deviceId !== undefined && input.deviceId !== null && !deviceId) {
    throw new OfflinePrepareError("Identificador do aparelho inválido.", 400, "invalid_device");
  }
  const name = deviceName(input.deviceName);

  return prisma.$transaction(async (tx) => {
    const cashRegister = await tx.cashRegister.findUnique({
      where: { openUserId: user.id },
      select: { id: true },
    });
    if (!cashRegister) {
      throw new OfflinePrepareError(
        "Abra o seu caixa antes de preparar o PDV para uso sem internet.",
        409,
        "cash_closed",
      );
    }

    const existing = deviceId
      ? await tx.offlineDevice.findUnique({ where: { id: deviceId } })
      : null;
    if (existing?.revokedAt) {
      throw new OfflinePrepareError(
        "Este aparelho foi bloqueado para o PDV sem internet. Fale com um gerente.",
        403,
        "device_revoked",
      );
    }

    const device = existing
      ? await tx.offlineDevice.update({
          where: { id: existing.id },
          data: { name, lastSyncAt: now },
        })
      : await tx.offlineDevice.create({
          data: { name, registeredById: user.id, lastSyncAt: now },
        });

    const grant = await tx.offlineGrant.create({
      data: {
        deviceId: device.id,
        userId: user.id,
        cashRegisterId: cashRegister.id,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + OFFLINE_GRANT_HOURS * 60 * 60 * 1000),
      },
    });

    return {
      device: { id: device.id, name: device.name },
      grant: {
        id: grant.id,
        issuedAt: grant.issuedAt.toISOString(),
        expiresAt: grant.expiresAt.toISOString(),
        cashRegisterId: grant.cashRegisterId,
      },
      user: { id: user.id, name: user.name, role: user.role },
    };
  });
}
