import { readStoreSettings } from "@/lib/store-settings-read";
import { Prisma, ReceivableStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Parâmetros da venda no Fiado (issue #29). Usado apenas no servidor. Sem configuração salva,
// valem os padrões da migration: fiado permitido, sem prazo, sem limite e sem bloqueio.

type Db = Prisma.TransactionClient | typeof prisma;

export interface OnAccountSettings {
  enabled: boolean;
  dueDays: number | null;
  creditLimit: Prisma.Decimal | null;
  blockOverdue: boolean;
}

/** Prazo máximo aceito para o vencimento (dias corridos). */
export const MAX_ON_ACCOUNT_DUE_DAYS = 3650;

export async function getOnAccountSettings(db: Db = prisma): Promise<OnAccountSettings> {
  const settings =
    db === prisma
      ? await readStoreSettings()
      : await db.storeSettings.findUnique({
          where: { id: "default" },
          select: {
            onAccountEnabled: true,
            onAccountDueDays: true,
            onAccountCreditLimit: true,
            onAccountBlockOverdue: true,
          },
        });
  return {
    enabled: settings?.onAccountEnabled ?? true,
    dueDays: settings?.onAccountDueDays ?? null,
    creditLimit: settings?.onAccountCreditLimit ?? null,
    blockOverdue: settings?.onAccountBlockOverdue ?? false,
  };
}

/** Títulos ainda não quitados (em aberto ou parciais). */
export const unpaidReceivables = { status: { not: ReceivableStatus.PAID } };

/**
 * Contas a Receber aparece no menu e no Dashboard enquanto o fiado estiver permitido ou houver
 * títulos a receber. É só exibição: o acesso continua controlado por `receivables.view`.
 * Em caso de falha do banco, mostra (fallback seguro, sem quebrar o layout).
 */
export async function isReceivablesVisible(): Promise<boolean> {
  try {
    const { enabled } = await getOnAccountSettings();
    if (enabled) return true;
    const unpaid = await prisma.receivable.findFirst({
      where: unpaidReceivables,
      select: { id: true },
    });
    return unpaid !== null;
  } catch (error) {
    console.error("Erro ao verificar a exibição de Contas a Receber:", error);
    return true;
  }
}
