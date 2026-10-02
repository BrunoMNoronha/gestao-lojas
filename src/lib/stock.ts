import { formatNumber } from "@/lib/utils";

// Unidades movimentadas apenas em quantidades inteiras (as demais aceitam até 3 casas decimais)
export const INTEGER_UNITS = ["UN", "CX"];

export const isIntegerUnit = (unit: string) => INTEGER_UNITS.includes(unit);

export const formatQuantity = (value: number, unit: string) =>
  formatNumber(value, isIntegerUnit(unit) ? 0 : 3);

// Regra única de "estoque baixo", usada no cadastro de produtos e no módulo de estoque.
// A consulta equivalente no banco fica em getLowStockProducts (src/actions/stock.ts).
export const isStockLow = (product: { currentStock: number; minStock: number }) =>
  product.currentStock <= product.minStock;

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  IN: "Entrada",
  OUT: "Saída",
  ADJUSTMENT: "Ajuste",
};
