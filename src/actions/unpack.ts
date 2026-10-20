"use server";

import { authorize } from "@/lib/authz";
import { registerUnpack, type UnpackInput, type UnpackResult } from "@/lib/unpack";
import { invalidateCatalog } from "@/lib/catalog-cache";
import { revalidatePath } from "next/cache";

function revalidateUnpackPaths() {
  try {
    revalidatePath("/admin/estoque");
    revalidatePath("/admin/produtos");
    revalidatePath("/admin/pdv");
    revalidatePath("/catalogo", "layout");
    invalidateCatalog();
  } catch (error) {
    // O commit já ocorreu. Falha de cache não transforma abertura confirmada em recusa.
    console.error("Falha ao atualizar telas após abertura confirmada:", error);
  }
}

export async function openStockBoxes(data: UnpackInput): Promise<UnpackResult> {
  try {
    const authz = await authorize("stock.manage");
    if (!authz.ok) return { success: false, error: authz.error, uncertain: true };
    const result = await registerUnpack(authz.user.id, data, "stock");
    if (result.success) revalidateUnpackPaths();
    return result;
  } catch (error) {
    console.error("Erro ao abrir caixas no estoque:", error);
    return {
      success: false,
      uncertain: true,
      error: "Falha ao registrar a abertura. Tente novamente com a mesma confirmação.",
    };
  }
}

export async function openPdvBoxes(data: UnpackInput): Promise<UnpackResult> {
  try {
    const authz = await authorize("pdv.use");
    if (!authz.ok) return { success: false, error: authz.error, uncertain: true };
    const result = await registerUnpack(authz.user.id, data, "pdv");
    if (result.success) revalidateUnpackPaths();
    return result;
  } catch (error) {
    console.error("Erro ao abrir caixas no PDV:", error);
    return {
      success: false,
      uncertain: true,
      error: "Falha ao registrar a abertura. Tente novamente com a mesma confirmação.",
    };
  }
}
