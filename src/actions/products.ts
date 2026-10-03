"use server";

import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { MovementType, Prisma, Unit } from "@prisma/client";
import { isHttpUrl } from "@/lib/catalog-shared";

export type UnitType = "UN" | "KG" | "LT" | "CX" | "M";

export interface ProductItem {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  // Preço de custo: só vem do servidor para quem tem `catalog.manage` (ADMIN / MANAGER).
  // Para os demais perfis o campo é omitido da resposta, não apenas escondido na tela.
  costPrice?: number;
  salePrice: number;
  unit: UnitType;
  currentStock: number;
  minStock: number;
  categoryId: string | null;
  categoryName?: string | null;
  // Catálogo público (/catalogo)
  showInCatalog: boolean;
  description: string | null;
  imageUrl: string | null;
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
  showInCatalog?: boolean;
  description?: string | null;
  imageUrl?: string | null;
}

const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_IMAGE_URL_LENGTH = 2048;

type CatalogFields =
  | { ok: true; showInCatalog: boolean; description: string | null; imageUrl: string | null }
  | { ok: false; error: string };

// Campos de vitrine do produto: descrição e imagem opcionais (imagem só por URL http/https)
function parseCatalogFields(data: ProductInput): CatalogFields {
  const description = data.description?.trim() || null;
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    return {
      ok: false,
      error: `A descrição pode ter no máximo ${MAX_DESCRIPTION_LENGTH} caracteres.`,
    };
  }
  const imageUrl = data.imageUrl?.trim() || null;
  if (imageUrl && (imageUrl.length > MAX_IMAGE_URL_LENGTH || !isHttpUrl(imageUrl))) {
    return { ok: false, error: "A URL da imagem deve começar com http:// ou https://." };
  }
  return { ok: true, showInCatalog: data.showInCatalog === true, description, imageUrl };
}

const PRODUCT_NOT_FOUND = "Produto não encontrado. Ele pode ter sido excluído; atualize a tela.";

// update com `where: { id, deletedAt: null }` lança P2025 quando o produto não existe ou foi excluído
const isNotFound = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";

function revalidateProductPaths() {
  revalidatePath("/admin/produtos");
  revalidatePath("/admin/estoque");
  revalidatePath("/catalogo", "layout");
}

export async function getProducts(
  searchQuery?: string,
  categoryId?: string,
): Promise<ProductItem[]> {
  try {
    const authz = await authorize("catalog.view");
    if (!authz.ok) return [];
    const canSeeCost = can(authz.user.role, "catalog.manage");

    // Produtos excluídos (exclusão lógica) não aparecem nas listagens
    const whereClause: Prisma.ProductWhereInput = { deletedAt: null };

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
      ...(canSeeCost ? { costPrice: Number(p.costPrice) } : {}),
      salePrice: Number(p.salePrice),
      unit: p.unit as UnitType,
      currentStock: Number(p.currentStock),
      minStock: Number(p.minStock),
      categoryId: p.categoryId,
      categoryName: p.category?.name ?? null,
      showInCatalog: p.showInCatalog,
      description: p.description,
      imageUrl: p.imageUrl,
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

    const catalog = parseCatalogFields(data);
    if (!catalog.ok) return { success: false, error: catalog.error };

    const sku = data.sku?.trim() || null;
    const barcode = data.barcode?.trim() || null;

    if (barcode) {
      const existingBarcode = await prisma.product.findFirst({
        where: { barcode, deletedAt: null },
      });
      if (existingBarcode) {
        return { success: false, error: "Já existe um produto com este Código de Barras." };
      }
    }

    if (sku) {
      const existingSku = await prisma.product.findFirst({
        where: { sku, deletedAt: null },
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
          showInCatalog: catalog.showInCatalog,
          description: catalog.description,
          imageUrl: catalog.imageUrl,
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

    revalidateProductPaths();
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

    const catalog = parseCatalogFields(data);
    if (!catalog.ok) return { success: false, error: catalog.error };

    const sku = data.sku?.trim() || null;
    const barcode = data.barcode?.trim() || null;

    if (barcode) {
      const existingBarcode = await prisma.product.findFirst({
        where: {
          barcode,
          deletedAt: null,
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
          deletedAt: null,
          NOT: { id },
        },
      });
      if (existingSku) {
        return { success: false, error: "Outro produto já possui este SKU." };
      }
    }

    const updatedProduct = await prisma.product.update({
      where: { id, deletedAt: null },
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
        showInCatalog: catalog.showInCatalog,
        description: catalog.description,
        imageUrl: catalog.imageUrl,
      },
    });

    revalidateProductPaths();
    return { success: true, data: { id: updatedProduct.id } };
  } catch (error) {
    if (isNotFound(error)) return { success: false, error: PRODUCT_NOT_FOUND };
    console.error("Erro ao atualizar produto:", error);
    return { success: false, error: "Falha ao atualizar o produto." };
  }
}

export async function deleteProduct(id: string) {
  try {
    const authz = await authorize("catalog.manage");
    if (!authz.ok) return { success: false, error: authz.error };

    // Exclusão lógica: o produto some das listagens e do catálogo, e o PDV offline recebe a
    // exclusão na próxima sincronização. Vendas e movimentações continuam com o histórico.
    await prisma.product.update({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    revalidateProductPaths();
    return { success: true };
  } catch (error) {
    if (isNotFound(error)) return { success: false, error: PRODUCT_NOT_FOUND };
    console.error("Erro ao excluir produto:", error);
    return { success: false, error: "Falha ao excluir o produto." };
  }
}
