"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import {
  type ApiKeyStatus,
  clearApiKey,
  readApiKey,
  readApiKeyStatus,
  saveApiKey,
  validateApiKeyFormat,
} from "@/lib/ai-key";
import { testApiKey } from "@/lib/insights/claude";

// Chave da API Anthropic dos insights (issue #113), só para o ADMIN. Nenhuma action devolve a
// chave: só o status e os últimos caracteres. Fica fora de getStoreSettings, que todo perfil lê.

export type { ApiKeyStatus } from "@/lib/ai-key";

type KeyActionResult = {
  success: boolean;
  error?: string;
  warning?: string;
  status?: ApiKeyStatus;
};

const EMPTY_STATUS: ApiKeyStatus = {
  configured: false,
  hint: null,
  updatedAt: null,
  readable: false,
};

export async function getAiKeyStatus(): Promise<ApiKeyStatus | null> {
  try {
    const authz = await authorize("settings.manage");
    if (!authz.ok) return null;
    return await readApiKeyStatus();
  } catch (error) {
    console.error("Erro ao ler o status da chave da API:", error);
    return null;
  }
}

export async function saveAnthropicApiKey(rawKey: string): Promise<KeyActionResult> {
  try {
    const authz = await authorize("settings.manage");
    if (!authz.ok) return { success: false, error: authz.error };

    const key = validateApiKeyFormat(rawKey);
    if (!key.ok) return { success: false, error: key.error };

    // Chave recusada não é salva; sem conseguir testar (rede, limite), salva e avisa
    const test = await testApiKey(key.value);
    if (!test.ok && !test.retryable) return { success: false, error: test.error };

    await saveApiKey(key.value);
    revalidatePath("/admin", "layout");
    return {
      success: true,
      status: await readApiKeyStatus(),
      warning: test.ok ? undefined : `Chave salva, mas não foi testada agora. ${test.error}`,
    };
  } catch (error) {
    console.error("Erro ao salvar a chave da API:", error instanceof Error ? error.name : error);
    return { success: false, error: "Falha ao salvar a chave. Tente novamente." };
  }
}

export async function testAnthropicApiKey(): Promise<KeyActionResult> {
  try {
    const authz = await authorize("settings.manage");
    if (!authz.ok) return { success: false, error: authz.error };

    const key = await readApiKey();
    if (!key) {
      return {
        success: false,
        error: "Nenhuma chave válida salva. Informe a chave da API de novo.",
      };
    }
    const test = await testApiKey(key);
    return test.ok ? { success: true } : { success: false, error: test.error };
  } catch (error) {
    console.error("Erro ao testar a chave da API:", error instanceof Error ? error.name : error);
    return { success: false, error: "Falha ao testar a chave. Tente novamente." };
  }
}

export async function removeAnthropicApiKey(): Promise<KeyActionResult> {
  try {
    const authz = await authorize("settings.manage");
    if (!authz.ok) return { success: false, error: authz.error };

    await clearApiKey();
    revalidatePath("/admin", "layout");
    return { success: true, status: EMPTY_STATUS };
  } catch (error) {
    console.error("Erro ao remover a chave da API:", error);
    return { success: false, error: "Falha ao remover a chave. Tente novamente." };
  }
}
