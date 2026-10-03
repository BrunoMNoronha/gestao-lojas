"use server";

import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/authz";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

export interface CategoryData {
  id: string;
  name: string;
  _count?: {
    products: number;
  };
}

const CATEGORY_SELECT = { id: true, name: true } as const;
const CATEGORY_NOT_FOUND = "Categoria não encontrada. Ela pode ter sido excluída; atualize a tela.";

// update com `where: { id, deletedAt: null }` lança P2025 quando a categoria não existe ou foi excluída
const isNotFound = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";

export async function getCategories(): Promise<CategoryData[]> {
  try {
    const authz = await authorize("catalog.view");
    if (!authz.ok) return [];

    // Categorias e produtos excluídos (exclusão lógica) ficam de fora, inclusive da contagem
    return await prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        _count: {
          select: { products: { where: { deletedAt: null } } },
        },
      },
    });
  } catch (error) {
    console.error("Erro ao buscar categorias:", error);
    return [];
  }
}

export async function createCategory(name: string) {
  try {
    const authz = await authorize("catalog.manage");
    if (!authz.ok) return { success: false, error: authz.error };

    const trimmedName = name.trim();
    if (!trimmedName) {
      return { success: false, error: "O nome da categoria é obrigatório." };
    }

    const existing = await prisma.category.findFirst({
      where: { name: trimmedName, deletedAt: null },
    });

    if (existing) {
      return { success: false, error: "Já existe uma categoria com este nome." };
    }

    const category = await prisma.category.create({
      data: { name: trimmedName },
      select: CATEGORY_SELECT,
    });

    revalidatePath("/admin/produtos");
    return { success: true, data: category };
  } catch (error) {
    console.error("Erro ao criar categoria:", error);
    return { success: false, error: "Falha ao criar categoria." };
  }
}

export async function updateCategory(id: string, name: string) {
  try {
    const authz = await authorize("catalog.manage");
    if (!authz.ok) return { success: false, error: authz.error };

    const trimmedName = name.trim();
    if (!trimmedName) {
      return { success: false, error: "O nome da categoria é obrigatório." };
    }

    const existing = await prisma.category.findFirst({
      where: {
        name: trimmedName,
        deletedAt: null,
        NOT: { id },
      },
    });

    if (existing) {
      return { success: false, error: "Já existe outra categoria com este nome." };
    }

    const category = await prisma.category.update({
      where: { id, deletedAt: null },
      data: { name: trimmedName },
      select: CATEGORY_SELECT,
    });

    revalidatePath("/admin/produtos");
    return { success: true, data: category };
  } catch (error) {
    if (isNotFound(error)) return { success: false, error: CATEGORY_NOT_FOUND };
    console.error("Erro ao atualizar categoria:", error);
    return { success: false, error: "Falha ao atualizar categoria." };
  }
}

export async function deleteCategory(id: string) {
  try {
    const authz = await authorize("catalog.manage");
    if (!authz.ok) return { success: false, error: authz.error };

    // Só produtos ativos impedem a exclusão; os excluídos mantêm a categoria no histórico
    const productsCount = await prisma.product.count({
      where: { categoryId: id, deletedAt: null },
    });

    if (productsCount > 0) {
      return {
        success: false,
        error: `Não é possível excluir esta categoria pois existem ${productsCount} produto(s) vinculados a ela.`,
      };
    }

    // Exclusão lógica: o PDV offline recebe a exclusão na próxima sincronização
    await prisma.category.update({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    revalidatePath("/admin/produtos");
    return { success: true };
  } catch (error) {
    if (isNotFound(error)) return { success: false, error: CATEGORY_NOT_FOUND };
    console.error("Erro ao excluir categoria:", error);
    return { success: false, error: "Falha ao excluir categoria." };
  }
}
