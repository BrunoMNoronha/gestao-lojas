"use server";

import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/authz";
import { revalidatePath } from "next/cache";
import { normalizeWhatsappNumber } from "@/lib/catalog-shared";
import { normalizeCep, normalizeDocument, normalizePhone } from "@/lib/masks";
import { parseMoney } from "@/lib/cash-register";
import { MAX_ON_ACCOUNT_DUE_DAYS } from "@/lib/on-account";
import type { StoreSettings } from "@prisma/client";

export type PersonTypeValue = "INDIVIDUAL" | "COMPANY";

export interface StoreSettingsData {
  // Pessoa Física (CPF, nome completo) ou Jurídica (CNPJ, razão social)
  personType?: PersonTypeValue;
  companyName: string;
  tradeName: string;
  document?: string;
  stateRegistration?: string;
  phone?: string;
  email?: string;
  zipCode?: string;
  address?: string;
  number?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  instagram?: string;
  facebook?: string;
  website?: string;
  receiptFooterNote?: string;
  // Catálogo público: WhatsApp só com dígitos (com DDI) e chave liga/desliga
  whatsappNumber?: string;
  catalogEnabled?: boolean;
  // Venda no Fiado: liga/desliga, prazo do título (dias), limite por cliente (R$) e bloqueio de
  // cliente com título vencido. Prazo e limite nulos = sem vencimento / sem limite.
  onAccountEnabled?: boolean;
  onAccountDueDays?: number | null;
  onAccountCreditLimit?: number | null;
  onAccountBlockOverdue?: boolean;
}

// Converte o registro do banco em dados serializáveis (o limite é Decimal no banco)
function toStoreSettingsData(settings: StoreSettings): StoreSettingsData {
  return {
    personType: settings.personType,
    companyName: settings.companyName ?? "",
    tradeName: settings.tradeName ?? "",
    document: settings.document ?? "",
    stateRegistration: settings.stateRegistration ?? "",
    phone: settings.phone ?? "",
    email: settings.email ?? "",
    zipCode: settings.zipCode ?? "",
    address: settings.address ?? "",
    number: settings.number ?? "",
    neighborhood: settings.neighborhood ?? "",
    city: settings.city ?? "",
    state: settings.state ?? "",
    instagram: settings.instagram ?? "",
    facebook: settings.facebook ?? "",
    website: settings.website ?? "",
    receiptFooterNote: settings.receiptFooterNote ?? "",
    whatsappNumber: settings.whatsappNumber ?? "",
    catalogEnabled: settings.catalogEnabled,
    onAccountEnabled: settings.onAccountEnabled,
    onAccountDueDays: settings.onAccountDueDays,
    onAccountCreditLimit: settings.onAccountCreditLimit?.toNumber() ?? null,
    onAccountBlockOverdue: settings.onAccountBlockOverdue,
  };
}

export async function getStoreSettings(): Promise<StoreSettingsData> {
  try {
    const authz = await authorize();
    if (!authz.ok) return { companyName: "Minha Loja Distribuidora", tradeName: "Minha Loja" };

    const settings = await prisma.storeSettings.findUnique({
      where: { id: "default" },
    });

    if (!settings) {
      return {
        personType: "COMPANY",
        companyName: "Minha Loja Distribuidora",
        tradeName: "Minha Loja",
        document: "",
        stateRegistration: "",
        phone: "",
        email: "",
        zipCode: "",
        address: "",
        number: "",
        neighborhood: "",
        city: "",
        state: "",
        instagram: "",
        facebook: "",
        website: "",
        receiptFooterNote: "Obrigado pela preferência! Volte sempre.",
        whatsappNumber: "",
        catalogEnabled: false,
        onAccountEnabled: true,
        onAccountDueDays: null,
        onAccountCreditLimit: null,
        onAccountBlockOverdue: false,
      };
    }

    return toStoreSettingsData(settings);
  } catch (error) {
    console.error("Erro ao buscar configurações da loja:", error);
    return {
      companyName: "Minha Loja Distribuidora",
      tradeName: "Minha Loja",
    };
  }
}

export async function updateStoreSettings(data: StoreSettingsData) {
  try {
    const authz = await authorize("settings.manage");
    if (!authz.ok) return { success: false, error: authz.error };

    const whatsappNumber = normalizeWhatsappNumber(data.whatsappNumber);
    if (whatsappNumber === null) {
      return {
        success: false,
        error: "Número do WhatsApp inválido. Informe DDD e número, ex.: (11) 99999-8888.",
      };
    }
    const catalogEnabled = data.catalogEnabled === true;

    const personType: PersonTypeValue = data.personType === "INDIVIDUAL" ? "INDIVIDUAL" : "COMPANY";
    const companyName = data.companyName?.trim();
    const tradeName = data.tradeName?.trim();
    if (!companyName || !tradeName) {
      return {
        success: false,
        error:
          personType === "INDIVIDUAL"
            ? "Informe o nome completo e o nome da loja."
            : "Informe a razão social e o nome fantasia.",
      };
    }
    // CPF/CNPJ, telefone e CEP são gravados sem pontuação
    const document = normalizeDocument(data.document, personType === "INDIVIDUAL" ? "CPF" : "CNPJ");
    if (!document.ok) return { success: false, error: document.error };
    const phone = normalizePhone(data.phone);
    if (!phone.ok) return { success: false, error: phone.error };
    const zipCode = normalizeCep(data.zipCode);
    if (!zipCode.ok) return { success: false, error: zipCode.error };

    // Fiado: prazo inteiro de 0 a 3650 dias e limite em reais não negativo (vazios = sem regra)
    const dueDays = data.onAccountDueDays ?? null;
    if (
      dueDays !== null &&
      (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > MAX_ON_ACCOUNT_DUE_DAYS)
    ) {
      return {
        success: false,
        error: `O prazo de vencimento do fiado deve ser um número inteiro de 0 a ${MAX_ON_ACCOUNT_DUE_DAYS} dias.`,
      };
    }
    const creditLimitInput = data.onAccountCreditLimit ?? null;
    const creditLimit =
      creditLimitInput === null ? null : parseMoney(creditLimitInput, { allowZero: true });
    if (creditLimitInput !== null && creditLimit === null) {
      return {
        success: false,
        error: "O limite de crédito do fiado deve ficar entre R$ 0,00 e R$ 1.000.000,00.",
      };
    }

    const values = {
      personType,
      companyName,
      tradeName,
      document: document.value,
      stateRegistration: data.stateRegistration || null,
      phone: phone.value,
      email: data.email || null,
      zipCode: zipCode.value,
      address: data.address || null,
      number: data.number || null,
      neighborhood: data.neighborhood || null,
      city: data.city || null,
      state: data.state || null,
      instagram: data.instagram || null,
      facebook: data.facebook || null,
      website: data.website || null,
      receiptFooterNote: data.receiptFooterNote || null,
      whatsappNumber: whatsappNumber || null,
      catalogEnabled,
      onAccountEnabled: data.onAccountEnabled !== false,
      onAccountDueDays: dueDays,
      onAccountCreditLimit: creditLimit,
      onAccountBlockOverdue: data.onAccountBlockOverdue === true,
    };

    const updated = await prisma.storeSettings.upsert({
      where: { id: "default" },
      update: values,
      create: { id: "default", ...values },
    });

    // Layout do painel: o menu "Contas a Receber" depende do fiado estar permitido
    revalidatePath("/admin", "layout");
    revalidatePath("/catalogo", "layout");
    return { success: true, data: toStoreSettingsData(updated) };
  } catch (error) {
    console.error("Erro ao atualizar configurações da loja:", error);
    return { success: false, error: "Falha ao salvar as configurações." };
  }
}
