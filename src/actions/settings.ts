"use server";

import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/authz";
import { revalidatePath } from "next/cache";

export interface StoreSettingsData {
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
      };
    }

    return {
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
    };
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

    const updated = await prisma.storeSettings.upsert({
      where: { id: "default" },
      update: {
        companyName: data.companyName,
        tradeName: data.tradeName,
        document: data.document || null,
        stateRegistration: data.stateRegistration || null,
        phone: data.phone || null,
        email: data.email || null,
        zipCode: data.zipCode || null,
        address: data.address || null,
        number: data.number || null,
        neighborhood: data.neighborhood || null,
        city: data.city || null,
        state: data.state || null,
        instagram: data.instagram || null,
        facebook: data.facebook || null,
        website: data.website || null,
        receiptFooterNote: data.receiptFooterNote || null,
      },
      create: {
        id: "default",
        companyName: data.companyName,
        tradeName: data.tradeName,
        document: data.document || null,
        stateRegistration: data.stateRegistration || null,
        phone: data.phone || null,
        email: data.email || null,
        zipCode: data.zipCode || null,
        address: data.address || null,
        number: data.number || null,
        neighborhood: data.neighborhood || null,
        city: data.city || null,
        state: data.state || null,
        instagram: data.instagram || null,
        facebook: data.facebook || null,
        website: data.website || null,
        receiptFooterNote: data.receiptFooterNote || null,
      },
    });

    revalidatePath("/admin/configuracoes");
    return { success: true, data: updated };
  } catch (error) {
    console.error("Erro ao atualizar configurações da loja:", error);
    return { success: false, error: "Falha ao salvar as configurações." };
  }
}
