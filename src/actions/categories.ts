"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export interface CategoryData {
  id: string;
  name: string;
  _count?: {
    products: number;
  };
}

export async function getCategories(): Promise<CategoryData[]> {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    return categories;
  } catch (error) {
    console.error("Erro ao buscar categorias:", error);
    return [];
  }
}

export async function createCategory(name: string) {
  try {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return { success: false, error: "O nome da categoria é obrigatório." };
    }

    const existing = await prisma.category.findUnique({
      where: { name: trimmedName },
    });

    if (existing) {
      return { success: false, error: "Já existe uma categoria com este nome." };
    }

    const category = await prisma.category.create({
      data: { name: trimmedName },
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
    const trimmedName = name.trim();
    if (!trimmedName) {
      return { success: false, error: "O nome da categoria é obrigatório." };
    }

    const existing = await prisma.category.findFirst({
      where: {
        name: trimmedName,
        NOT: { id },
      },
    });

    if (existing) {
      return { success: false, error: "Já existe outra categoria com este nome." };
    }

    const category = await prisma.category.update({
      where: { id },
      data: { name: trimmedName },
    });

    revalidatePath("/admin/produtos");
    return { success: true, data: category };
  } catch (error) {
    console.error("Erro ao atualizar categoria:", error);
    return { success: false, error: "Falha ao atualizar categoria." };
  }
}

export async function deleteCategory(id: string) {
  try {
    const productsCount = await prisma.product.count({
      where: { categoryId: id },
    });

    if (productsCount > 0) {
      return {
        success: false,
        error: `Não é possível excluir esta categoria pois existem ${productsCount} produto(s) vinculados a ela.`,
      };
    }

    await prisma.category.delete({
      where: { id },
    });

    revalidatePath("/admin/produtos");
    return { success: true };
  } catch (error) {
    console.error("Erro ao excluir categoria:", error);
    return { success: false, error: "Falha ao excluir categoria." };
  }
}
