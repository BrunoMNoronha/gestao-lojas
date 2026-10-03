"use server";

import { authorize } from "@/lib/authz";
import { revalidatePath } from "next/cache";
import { registerSale, type CreateSaleInput } from "@/lib/create-sale";

// As regras da venda (preço, estoque, caixa, Fiado e idempotência pela chave da operação)
// ficam em src/lib/create-sale.ts. Aqui: autorização do operador e revalidação das telas.
export async function createSale(data: CreateSaleInput) {
  try {
    // A venda é sempre atribuída ao operador logado
    const authz = await authorize("pdv.use");
    if (!authz.ok) {
      return { success: false, error: authz.error };
    }

    const result = await registerSale(authz.user.id, data);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Também num reenvio: a resposta original pode ter se perdido antes de atualizar as telas
    revalidatePath("/admin/pdv");
    revalidatePath("/admin/produtos");
    revalidatePath("/admin/estoque");
    revalidatePath("/admin/caixa");
    revalidatePath("/admin/contas-a-receber");

    return { success: true, data: result.data };
  } catch (error) {
    console.error("Erro ao registrar venda:", error);
    return { success: false, error: "Falha ao processar a venda no banco de dados." };
  }
}
