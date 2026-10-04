"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_TEST_DATA_COUNTS,
  TEST_DATA_LIMITS,
  type TestDataCounts,
} from "@/lib/test-data-generator";
import {
  generateTestData,
  getRecentTestDataRuns,
  getResetBlockers,
  resetStoreData,
  type GeneratedCounts,
  type ResetBlockers,
  type ResetCounts,
  type TestDataRunItem,
} from "@/lib/test-data";

// Seção "Dados de teste" em Configurações (issue #57): só ADMIN ("settings.manage"). As regras
// ficam em src/lib/test-data.ts; aqui só autorização, resposta ao navegador e revalidação.

export interface TestDataOverview {
  limits: TestDataCounts;
  defaults: TestDataCounts;
  blockers: ResetBlockers;
  runs: TestDataRunItem[];
  // Nome fantasia a digitar na confirmação; null se a loja ainda não salvou as configurações
  tradeName: string | null;
}

export type GenerateTestDataResponse =
  | { success: true; data: { counts: GeneratedCounts; replayed: boolean } }
  | { success: false; error: string };

export type ResetStoreDataResponse =
  | { success: true; data: { counts: ResetCounts; replayed: boolean } }
  | { success: false; error: string; blockers?: ResetBlockers };

/** Geração e restauração mudam dados de quase todo o painel e do catálogo público. */
function revalidateAffectedPaths() {
  revalidatePath("/admin", "layout");
  revalidatePath("/catalogo", "layout");
}

/** Dados da seção: tetos, impedimentos da restauração e últimas execuções. Null sem permissão. */
export async function getTestDataOverview(): Promise<TestDataOverview | null> {
  const authz = await authorize("settings.manage");
  if (!authz.ok) return null;

  try {
    const [blockers, runs, settings] = await Promise.all([
      getResetBlockers(),
      getRecentTestDataRuns(),
      prisma.storeSettings.findUnique({ where: { id: "default" }, select: { tradeName: true } }),
    ]);
    return {
      limits: { ...TEST_DATA_LIMITS },
      defaults: { ...DEFAULT_TEST_DATA_COUNTS },
      blockers,
      runs,
      tradeName: settings?.tradeName.trim() || null,
    };
  } catch (error) {
    console.error("Erro ao carregar a seção de dados de teste:", error);
    return null;
  }
}

export async function generateTestDataAction(input: {
  requestId: string;
  counts: TestDataCounts;
}): Promise<GenerateTestDataResponse> {
  const authz = await authorize("settings.manage");
  if (!authz.ok) return { success: false, error: authz.error };

  try {
    const result = await generateTestData(authz.user, input?.requestId, input?.counts);
    if (!result.ok) return { success: false, error: result.error };
    revalidateAffectedPaths();
    return { success: true, data: { counts: result.counts, replayed: result.replayed } };
  } catch (error) {
    console.error("Erro ao gerar dados de teste:", error);
    return { success: false, error: "Falha ao gerar os dados de teste." };
  }
}

export async function resetStoreDataAction(input: {
  requestId: string;
  tradeName: string;
  password: string;
}): Promise<ResetStoreDataResponse> {
  const authz = await authorize("settings.manage");
  if (!authz.ok) return { success: false, error: authz.error };

  try {
    const result = await resetStoreData(authz.user, input?.requestId, {
      tradeName: input?.tradeName,
      password: input?.password,
    });
    if (!result.ok) {
      return result.blockers
        ? { success: false, error: result.error, blockers: result.blockers }
        : { success: false, error: result.error };
    }
    revalidateAffectedPaths();
    return { success: true, data: { counts: result.counts, replayed: result.replayed } };
  } catch (error) {
    console.error("Erro ao restaurar o banco:", error);
    return { success: false, error: "Falha ao restaurar o banco. Nada foi apagado." };
  }
}
