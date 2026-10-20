import type { Unit } from "@prisma/client";
import type { LocalCategory, LocalProduct } from "@/lib/offline/db";
import { availableStock } from "@/lib/offline/sale-operation";
import { isStockLow } from "@/lib/stock";

// Consulta de estoque do /pdv (issue #54, docs/OFFLINE.md seção 6.2). Funções puras, sem
// IndexedDB: saldo da cópia local menos as vendas da fila que ela ainda não mostra (o mesmo
// número que o terminal usa para limitar a venda), estoque baixo e filtros. Só leitura.

/**
 * Acima disso a consulta avisa que os dados podem estar desatualizados. É só um aviso: o
 * bloqueio do PDV continua nas 24 horas da seção 3.5.
 */
export const STOCK_STALE_WARNING_MS = 4 * 60 * 60 * 1000;

export interface StockRow {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: Unit;
  categoryId: string | null;
  categoryName: string | null;
  // Saldo da última sincronização
  syncedStock: number;
  // Reservado pelas vendas deste aparelho ainda não refletidas na cópia
  pending: number;
  // Saldo disponível: sincronizado menos pendentes
  available: number;
  // null: a cópia ainda não tem o estoque mínimo (guardada antes da #54, até a próxima preparação)
  minStock: number | null;
  // Estoque baixo pelo saldo disponível; null quando o mínimo é desconhecido
  low: boolean | null;
}

export function buildStockRows(
  products: LocalProduct[],
  categories: LocalCategory[],
  reserved: Map<string, number>,
): StockRow[] {
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  return products
    .map((p) => {
      const pending = reserved.get(p.id) ?? 0;
      const available = availableStock(p.currentStock, pending);
      const minStock = p.minStock === undefined ? null : Number(p.minStock);
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        unit: p.unit,
        categoryId: p.categoryId,
        categoryName: p.categoryId ? (categoryNames.get(p.categoryId) ?? null) : null,
        syncedStock: Number(p.currentStock),
        pending,
        available,
        minStock,
        low: minStock === null ? null : isStockLow({ currentStock: available, minStock }),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export interface StockFilter {
  query: string;
  // "" = todas; "none" = sem categoria
  categoryId: string;
  onlyLow: boolean;
}

/** Busca por nome, SKU ou código de barras (como no terminal), categoria e estoque baixo. */
export function filterStockRows(rows: StockRow[], filter: StockFilter): StockRow[] {
  const q = filter.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.onlyLow && row.low !== true) return false;
    if (filter.categoryId === "none" && row.categoryId !== null) return false;
    if (filter.categoryId && filter.categoryId !== "none" && row.categoryId !== filter.categoryId) {
      return false;
    }
    if (!q) return true;
    return (
      row.name.toLowerCase().includes(q) ||
      !!row.sku?.toLowerCase().includes(q) ||
      !!row.barcode?.toLowerCase().includes(q)
    );
  });
}
