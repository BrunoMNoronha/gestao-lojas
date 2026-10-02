import { prisma } from "@/lib/prisma";

export const DEFAULT_BRAND_NAME = "Gestão de Lojas";

// Nome exibido na marca do painel: o nome fantasia configurado em /admin/configuracoes.
// Leitura sem dados sensíveis; qualquer falha de banco cai no nome padrão para não quebrar o layout.
export async function getStoreBrandName(): Promise<string> {
  try {
    const settings = await prisma.storeSettings.findUnique({
      where: { id: "default" },
      select: { tradeName: true },
    });
    return settings?.tradeName?.trim() || DEFAULT_BRAND_NAME;
  } catch (error) {
    console.error("Erro ao carregar o nome da loja:", error);
    return DEFAULT_BRAND_NAME;
  }
}
