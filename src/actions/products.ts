"use server";

import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/authz";
import { revalidatePath } from "next/cache";
import { MovementType, Prisma, Unit } from "@prisma/client";

export type UnitType = "UN" | "KG" | "LT" | "CX" | "M";

export interface ProductItem {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  costPrice: number;
  salePrice: number;
  unit: UnitType;
  currentStock: number;
  minStock: number;
  categoryId: string | null;
  categoryName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  id?: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  costPrice: number;
  salePrice: number;
  unit?: UnitType;
  // Usado apenas no cadastro (estoque inicial). Depois, o saldo muda só pelo módulo Estoque.
  currentStock?: number;
  minStock?: number;
  categoryId?: string | null;
}

export async function getProducts(searchQuery?: string, categoryId?: string): Promise<ProductItem[]> {
  try {
    const authz = await authorize("catalog.view");
    if (!authz.ok) return [];

    const whereClause: any = {};

    if (searchQuery && searchQuery.trim() !== "") {
      const q = searchQuery.trim();
      whereClause.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { barcode: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
      ];
    }

    if (categoryId && categoryId !== "ALL") {
      whereClause.categoryId = categoryId;
    }

    const products = await prisma.product.findMany({
      where: whereClause,
      include: {
        category: {
          select: { id: true, name: true },
        },
      },
      orderBy: { name: "asc" },
    });

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      costPrice: Number(p.costPrice),
      salePrice: Number(p.salePrice),
      unit: p.unit as UnitType,
      currentStock: Number(p.currentStock),
      minStock: Number(p.minStock),
      categoryId: p.categoryId,
      categoryName: p.category?.name ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));
  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    return [];
  }
}

export async function createProduct(data: ProductInput) {
  try {
    const authz = await authorize("catalog.manage");
    if (!authz.ok) return { success: false, error: authz.error };

    const name = data.name?.trim();
    if (!name) {
      return { success: false, error: "O nome do produto é obrigatório." };
    }

    const sku = data.sku?.trim() || null;
    const barcode = data.barcode?.trim() || null;

    if (barcode) {
      const existingBarcode = await prisma.product.findUnique({
        where: { barcode },
      });
      if (existingBarcode) {
        return { success: false, error: "Já existe um produto com este Código de Barras." };
      }
    }

    if (sku) {
      const existingSku = await prisma.product.findUnique({
        where: { sku },
      });
      if (existingSku) {
        return { success: false, error: "Já existe um produto com este SKU." };
      }
    }

    const unit = (data.unit as Unit) || Unit.UN;
    const initialStockInput = data.currentStock ?? 0;
    if (!Number.isFinite(initialStockInput) || initialStockInput < 0) {
      return { success: false, error: "O estoque inicial não pode ser negativo." };
    }
    const initialStock = new Prisma.Decimal(initialStockInput).toDecimalPlaces(3);
    if ((unit === Unit.UN || unit === Unit.CX) && !initialStock.isInteger()) {
      return {
        success: false,
        error: `Produtos controlados por ${unit} aceitam apenas estoque inicial inteiro.`,
      };
    }

    const userId = authz.user.id;

    // O estoque inicial gera a primeira movimentação, mantendo o histórico completo
    const newProduct = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name,
          sku,
          barcode,
          costPrice: data.costPrice ?? 0,
          salePrice: data.salePrice ?? 0,
          unit,
          currentStock: initialStock,
          minStock: data.minStock ?? 0,
          categoryId: data.categoryId || null,
        },
      });

      if (initialStock.gt(0)) {
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            type: MovementType.IN,
            quantity: initialStock,
            reason: "Estoque inicial",
            userId,
          },
        });
      }

      return product;
    });

    revalidatePath("/admin/produtos");
    revalidatePath("/admin/estoque");
    // Só o id: objetos Decimal do Prisma não podem ser enviados ao cliente
    return { success: true, data: { id: newProduct.id } };
  } catch (error) {
    console.error("Erro ao criar produto:", error);
    return { success: false, error: "Falha ao criar o produto." };
  }
}

export async function updateProduct(id: string, data: ProductInput) {
  try {
    const authz = await authorize("catalog.manage");
    if (!authz.ok) return { success: false, error: authz.error };

    const name = data.name?.trim();
    if (!name) {
      return { success: false, error: "O nome do produto é obrigatório." };
    }

    const sku = data.sku?.trim() || null;
    const barcode = data.barcode?.trim() || null;

    if (barcode) {
      const existingBarcode = await prisma.product.findFirst({
        where: {
          barcode,
          NOT: { id },
        },
      });
      if (existingBarcode) {
        return { success: false, error: "Outro produto já possui este Código de Barras." };
      }
    }

    if (sku) {
      const existingSku = await prisma.product.findFirst({
        where: {
          sku,
          NOT: { id },
        },
      });
      if (existingSku) {
        return { success: false, error: "Outro produto já possui este SKU." };
      }
    }

    const updatedProduct = await prisma.product.update({
      where: { id },
      data: {
        name,
        sku,
        barcode,
        costPrice: data.costPrice ?? 0,
        salePrice: data.salePrice ?? 0,
        unit: (data.unit as Unit) || Unit.UN,
        // currentStock não é alterado aqui: use registerStockEntry/adjustStock (src/actions/stock.ts)
        minStock: data.minStock ?? 0,
        categoryId: data.categoryId || null,
      },
    });

    revalidatePath("/admin/produtos");
    revalidatePath("/admin/estoque");
    return { success: true, data: { id: updatedProduct.id } };
  } catch (error) {
    console.error("Erro ao atualizar produto:", error);
    return { success: false, error: "Falha ao atualizar o produto." };
  }
}

export async function deleteProduct(id: string) {
  try {
    const authz = await authorize("catalog.manage");
    if (!authz.ok) return { success: false, error: authz.error };

    await prisma.product.delete({
      where: { id },
    });

    revalidatePath("/admin/produtos");
    revalidatePath("/admin/estoque");
    return { success: true };
  } catch (error) {
    console.error("Erro ao excluir produto:", error);
    return {
      success: false,
      error:
        "Falha ao excluir o produto. Verifique se existem vendas ou movimentações de estoque associadas.",
    };
  }
}
