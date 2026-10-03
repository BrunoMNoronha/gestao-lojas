"use server";

import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { MovementType, Prisma, Unit } from "@prisma/client";
import type { UnitType } from "@/actions/products";

export type MovementTypeValue = "IN" | "OUT" | "ADJUSTMENT";

export interface StockMovementItem {
  id: string;
  productId: string;
  productName: string;
  unit: UnitType;
  type: MovementTypeValue;
  // IN/OUT: quantidade positiva. ADJUSTMENT: delta com sinal.
  quantity: number;
  reason: string | null;
  // Custo da entrada: omitido para quem não tem `catalog.manage` (mesma regra do preço de custo)
  unitCost?: number | null;
  userName: string | null;
  supplierName: string | null;
  createdAt: string;
}

export interface StockMovementFilters {
  productId?: string | null;
  type?: MovementTypeValue | null;
  // Limites em ISO 8601, calculados no navegador a partir do dia local do usuário
  from?: string | null;
  to?: string | null;
  take?: number;
  skip?: number;
}

export interface StockMovementPage {
  items: StockMovementItem[];
  total: number;
}

export interface LowStockItem {
  id: string;
  name: string;
  unit: UnitType;
  currentStock: number;
  minStock: number;
  deficit: number;
  categoryName: string | null;
}

export interface StockEntryInput {
  productId: string;
  quantity: number;
  supplierId?: string | null;
  unitCost?: number | null;
  reason?: string | null;
}

export interface StockAdjustmentInput {
  productId: string;
  countedQuantity: number;
  reason: string;
}

const INTEGER_UNITS: Unit[] = [Unit.UN, Unit.CX];
const MAX_QUANTITY = 1_000_000;
const MAX_REASON_LENGTH = 200;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

// Erro de regra de negócio: a mensagem é segura para exibir ao usuário.
class StockValidationError extends Error {}

function toNumberOrNaN(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function revalidateStockPaths() {
  revalidatePath("/admin/estoque");
  revalidatePath("/admin/produtos");
  revalidatePath("/admin/pdv");
}

export async function getStockMovements(
  filters: StockMovementFilters = {},
): Promise<StockMovementPage> {
  try {
    const authz = await authorize("stock.view");
    if (!authz.ok) return { items: [], total: 0 };
    const canSeeCost = can(authz.user.role, "catalog.manage");

    const where: Prisma.StockMovementWhereInput = {};
    if (filters.productId) where.productId = filters.productId;
    if (filters.type && Object.values(MovementType).includes(filters.type)) {
      where.type = filters.type;
    }
    const from = parseDate(filters.from);
    const to = parseDate(filters.to);
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const take = Math.min(
      Math.max(Math.trunc(filters.take ?? DEFAULT_PAGE_SIZE), 1),
      MAX_PAGE_SIZE,
    );
    const skip = Math.max(Math.trunc(filters.skip ?? 0), 0);

    const [movements, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        include: {
          product: { select: { name: true, unit: true } },
          user: { select: { name: true } },
          supplier: { select: { name: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
        skip,
      }),
      prisma.stockMovement.count({ where }),
    ]);

    return {
      items: movements.map((m) => ({
        id: m.id,
        productId: m.productId,
        productName: m.product.name,
        unit: m.product.unit as UnitType,
        type: m.type as MovementTypeValue,
        quantity: Number(m.quantity),
        reason: m.reason,
        ...(canSeeCost ? { unitCost: m.unitCost === null ? null : Number(m.unitCost) } : {}),
        userName: m.user?.name ?? null,
        supplierName: m.supplier?.name ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
      total,
    };
  } catch (error) {
    console.error("Erro ao buscar movimentações de estoque:", error);
    return { items: [], total: 0 };
  }
}

export async function getLowStockProducts(): Promise<LowStockItem[]> {
  try {
    const authz = await authorize("stock.view");
    if (!authz.ok) return [];

    // Mesma regra de isStockLow (src/lib/stock.ts): saldo atual <= estoque mínimo
    const products = await prisma.product.findMany({
      where: { currentStock: { lte: prisma.product.fields.minStock } },
      include: { category: { select: { name: true } } },
      orderBy: { name: "asc" },
    });

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      unit: p.unit as UnitType,
      currentStock: Number(p.currentStock),
      minStock: Number(p.minStock),
      deficit: p.minStock.sub(p.currentStock).toNumber(),
      categoryName: p.category?.name ?? null,
    }));
  } catch (error) {
    console.error("Erro ao buscar produtos abaixo do estoque mínimo:", error);
    return [];
  }
}

export async function registerStockEntry(data: StockEntryInput) {
  try {
    const authz = await authorize("stock.manage");
    if (!authz.ok) {
      return { success: false, error: authz.error };
    }
    const userId = authz.user.id;

    if (typeof data?.productId !== "string" || !data.productId) {
      return { success: false, error: "Selecione o produto da entrada." };
    }

    const quantityInput = toNumberOrNaN(data.quantity);
    if (!Number.isFinite(quantityInput) || quantityInput <= 0) {
      return { success: false, error: "A quantidade da entrada deve ser maior que zero." };
    }
    if (quantityInput > MAX_QUANTITY) {
      return { success: false, error: "Quantidade acima do limite permitido por entrada." };
    }
    const quantity = new Prisma.Decimal(quantityInput).toDecimalPlaces(3);
    if (quantity.lte(0)) {
      return { success: false, error: "A quantidade da entrada deve ser maior que zero." };
    }

    let unitCost: Prisma.Decimal | null = null;
    if (data.unitCost !== undefined && data.unitCost !== null) {
      const costInput = toNumberOrNaN(data.unitCost);
      if (!Number.isFinite(costInput) || costInput < 0) {
        return { success: false, error: "O custo unitário não pode ser negativo." };
      }
      unitCost = new Prisma.Decimal(costInput).toDecimalPlaces(2);
    }

    const reason = data.reason?.trim() || null;
    if (reason && reason.length > MAX_REASON_LENGTH) {
      return {
        success: false,
        error: `A observação deve ter até ${MAX_REASON_LENGTH} caracteres.`,
      };
    }

    const supplierId = data.supplierId || null;

    await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: data.productId },
        select: { id: true, name: true, unit: true },
      });
      if (!product) {
        throw new StockValidationError("Produto não encontrado. Atualize a tela.");
      }
      if (INTEGER_UNITS.includes(product.unit) && !quantity.isInteger()) {
        throw new StockValidationError(
          `"${product.name}" é controlado por ${product.unit} e aceita apenas quantidades inteiras.`,
        );
      }

      if (supplierId) {
        const supplier = await tx.supplier.findUnique({
          where: { id: supplierId },
          select: { id: true },
        });
        if (!supplier) {
          throw new StockValidationError("Fornecedor selecionado não foi encontrado.");
        }
      }

      await tx.product.update({
        where: { id: product.id },
        data: { currentStock: { increment: quantity } },
      });

      await tx.stockMovement.create({
        data: {
          productId: product.id,
          type: MovementType.IN,
          quantity,
          unitCost,
          reason,
          userId,
          supplierId,
        },
      });
    });

    revalidateStockPaths();
    return { success: true };
  } catch (error) {
    if (error instanceof StockValidationError) {
      return { success: false, error: error.message };
    }
    console.error("Erro ao registrar entrada de estoque:", error);
    return { success: false, error: "Falha ao registrar a entrada no banco de dados." };
  }
}

export async function adjustStock(data: StockAdjustmentInput) {
  try {
    const authz = await authorize("stock.manage");
    if (!authz.ok) {
      return { success: false, error: authz.error };
    }
    const userId = authz.user.id;

    if (typeof data?.productId !== "string" || !data.productId) {
      return { success: false, error: "Selecione o produto a ajustar." };
    }

    const countedInput = toNumberOrNaN(data.countedQuantity);
    if (!Number.isFinite(countedInput) || countedInput < 0) {
      return { success: false, error: "O saldo contado não pode ser negativo." };
    }
    if (countedInput > MAX_QUANTITY) {
      return { success: false, error: "Saldo contado acima do limite permitido." };
    }
    const counted = new Prisma.Decimal(countedInput).toDecimalPlaces(3);

    const reason = typeof data.reason === "string" ? data.reason.trim() : "";
    if (!reason) {
      return { success: false, error: "Informe o motivo do ajuste." };
    }
    if (reason.length > MAX_REASON_LENGTH) {
      return { success: false, error: `O motivo deve ter até ${MAX_REASON_LENGTH} caracteres.` };
    }

    await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: data.productId },
        select: { id: true, name: true, unit: true, currentStock: true },
      });
      if (!product) {
        throw new StockValidationError("Produto não encontrado. Atualize a tela.");
      }
      if (INTEGER_UNITS.includes(product.unit) && !counted.isInteger()) {
        throw new StockValidationError(
          `"${product.name}" é controlado por ${product.unit} e aceita apenas quantidades inteiras.`,
        );
      }

      const delta = counted.sub(product.currentStock);
      if (delta.isZero()) {
        throw new StockValidationError("O saldo contado é igual ao saldo atual. Nada a ajustar.");
      }

      // Guarda otimista: só grava se o saldo não mudou desde a leitura (ex.: venda simultânea)
      const updated = await tx.product.updateMany({
        where: { id: product.id, currentStock: product.currentStock },
        data: { currentStock: counted },
      });
      if (updated.count === 0) {
        throw new StockValidationError("O estoque mudou, recarregue e tente novamente.");
      }

      await tx.stockMovement.create({
        data: {
          productId: product.id,
          type: MovementType.ADJUSTMENT,
          quantity: delta,
          reason,
          userId,
        },
      });
    });

    revalidateStockPaths();
    return { success: true };
  } catch (error) {
    if (error instanceof StockValidationError) {
      return { success: false, error: error.message };
    }
    console.error("Erro ao ajustar estoque:", error);
    return { success: false, error: "Falha ao ajustar o estoque no banco de dados." };
  }
}
