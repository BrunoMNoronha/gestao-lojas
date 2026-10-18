import { prisma } from "@/lib/prisma";
import { readStoreSettings } from "@/lib/store-settings-read";
import { openText, sealText } from "@/lib/secret-box";

// Chave da API Anthropic da loja (issue #113), só no servidor. O banco guarda o valor cifrado
// (src/lib/secret-box.ts) e os últimos caracteres para o ADMIN reconhecer a chave salva; o valor
// em claro só existe na memória do servidor durante a chamada ao Claude e nunca vai ao navegador.

const KEY_BOX = { info: "store-ai-key-v1", version: 1 };
const KEY_RE = /^sk-ant-[A-Za-z0-9_-]{20,250}$/;
const HINT_LENGTH = 4;

export type ApiKeyFormat = { ok: true; value: string } | { ok: false; error: string };

/** Confere o formato da chave digitada (sem chamar a Anthropic). */
export function validateApiKeyFormat(raw: unknown): ApiKeyFormat {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { ok: false, error: "Informe a chave da API." };
  if (!KEY_RE.test(value)) {
    return {
      ok: false,
      error: "Chave em formato inválido. A chave da API Anthropic começa com sk-ant-.",
    };
  }
  return { ok: true, value };
}

export const apiKeyHint = (key: string) => key.slice(-HINT_LENGTH);

export async function saveApiKey(key: string) {
  const values = {
    anthropicApiKeyEnc: sealText(key, KEY_BOX),
    anthropicApiKeyHint: apiKeyHint(key),
    anthropicApiKeyUpdatedAt: new Date(),
  };
  // Sem configuração salva ainda: cria a linha com os nomes padrão da tela de configurações
  await prisma.storeSettings.upsert({
    where: { id: "default" },
    update: values,
    create: {
      id: "default",
      companyName: "Minha Loja Distribuidora",
      tradeName: "Minha Loja",
      ...values,
    },
  });
}

export async function clearApiKey() {
  await prisma.storeSettings.updateMany({
    where: { id: "default" },
    data: { anthropicApiKeyEnc: null, anthropicApiKeyHint: null, anthropicApiKeyUpdatedAt: null },
  });
}

export interface ApiKeyStatus {
  configured: boolean;
  hint: string | null;
  updatedAt: string | null;
  // false quando a chave salva não abre mais (AUTH_SECRET trocado): precisa ser informada de novo
  readable: boolean;
}

export async function readApiKeyStatus(): Promise<ApiKeyStatus> {
  const settings = await prisma.storeSettings.findUnique({
    where: { id: "default" },
    select: {
      anthropicApiKeyEnc: true,
      anthropicApiKeyHint: true,
      anthropicApiKeyUpdatedAt: true,
    },
  });
  const sealed = settings?.anthropicApiKeyEnc ?? null;
  return {
    configured: sealed !== null,
    hint: settings?.anthropicApiKeyHint ?? null,
    updatedAt: settings?.anthropicApiKeyUpdatedAt?.toISOString() ?? null,
    readable: sealed !== null && openText(sealed, KEY_BOX) !== null,
  };
}

/** Chave em claro para chamar o Claude; null se não houver chave ou se ela não abrir. */
export async function readApiKey(): Promise<string | null> {
  const settings = await prisma.storeSettings.findUnique({
    where: { id: "default" },
    select: { anthropicApiKeyEnc: true },
  });
  const sealed = settings?.anthropicApiKeyEnc;
  return sealed ? openText(sealed, KEY_BOX) : null;
}

// Item "Insights" do menu: só com chave salva. Mesma leitura de StoreSettings do layout (cache da
// requisição); falha de banco esconde o item em vez de quebrar o painel.
export async function isAiInsightsConfigured(): Promise<boolean> {
  try {
    const settings = await readStoreSettings();
    return Boolean(settings?.anthropicApiKeyEnc);
  } catch (error) {
    console.error("Erro ao verificar a chave da API dos insights:", error);
    return false;
  }
}
