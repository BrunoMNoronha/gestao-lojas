// Regras do catálogo público (issue #17) usadas no navegador e no servidor: unidades, quantidades,
// URL de imagem e número do WhatsApp. Sem acesso a banco: pode ser importado por Client Components.

export type CatalogUnit = "UN" | "KG" | "LT" | "CX" | "M";

export const CATALOG_PAGE_SIZE = 24;
export const MAX_ORDER_ITEMS = 100;
export const MAX_ITEM_QUANTITY = 10000;

export const CATALOG_SORTS = ["nome", "menor-preco", "maior-preco"] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

export const CATALOG_SORT_LABELS: Record<CatalogSort, string> = {
  nome: "Nome (A–Z)",
  "menor-preco": "Menor preço",
  "maior-preco": "Maior preço",
};

/** KG, LT e M aceitam até 3 casas decimais; UN e CX só quantidades inteiras. */
export function isFractionalUnit(unit: CatalogUnit): boolean {
  return unit === "KG" || unit === "LT" || unit === "M";
}

/** Passo dos botões +/− do carrinho. */
export function quantityStep(unit: CatalogUnit): number {
  return isFractionalUnit(unit) ? 0.5 : 1;
}

/**
 * Quantidade válida para a unidade (> 0, até MAX_ITEM_QUANTITY, inteira em UN/CX e com até
 * 3 casas em KG/LT/M) ou null. Não arredonda: valor fora da regra é inválido.
 */
export function validQuantity(unit: CatalogUnit, value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value <= 0 || value > MAX_ITEM_QUANTITY) return null;
  const decimals = isFractionalUnit(unit) ? 3 : 0;
  const factor = 10 ** decimals;
  if (Math.abs(Math.round(value * factor) - value * factor) > 1e-6) return null;
  return Math.round(value * factor) / factor;
}

export function formatQuantity(unit: CatalogUnit, value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: isFractionalUnit(unit) ? 3 : 0,
  }).format(value);
}

/** Texto do campo de quantidade: vírgula decimal, sem separador de milhar. */
export function quantityInputText(value: number): string {
  return String(value).replace(".", ",");
}

/** Lê o campo de quantidade aceitando vírgula ou ponto como separador decimal. */
export function parseQuantityInput(text: string): number {
  const value = text.trim();
  return Number(value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value);
}

/** Aceita apenas URL absoluta http(s). */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Número do WhatsApp guardado só com dígitos e DDI (ex.: 5511999998888). Sem DDI (10 ou 11
 * dígitos), assume Brasil (55). Retorna "" para vazio e null para número inválido.
 */
export function normalizeWhatsappNumber(input: string | null | undefined): string | null {
  const digits = (input ?? "").replace(/\D/g, "");
  if (digits === "") return "";
  const full = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  if (full.startsWith("55")) return full.length === 12 || full.length === 13 ? full : null;
  return full.length >= 10 && full.length <= 15 ? full : null;
}

/** Máscara de exibição: +55 (11) 99999-8888 para números do Brasil; demais, +dígitos. */
export function formatWhatsappNumber(digits: string): string {
  if (!digits) return "";
  if (!digits.startsWith("55") || digits.length <= 2) return `+${digits}`;
  const ddd = digits.slice(2, 4);
  const rest = digits.slice(4);
  if (!rest) return `+55 (${ddd}`;
  if (rest.length <= 4) return `+55 (${ddd}) ${rest}`;
  return `+55 (${ddd}) ${rest.slice(0, -4)}-${rest.slice(-4)}`;
}

// Filtros do catálogo refletidos na URL (?q=&categoria=&disponiveis=1&ordem=&pagina=)
export interface CatalogFilters {
  q: string;
  category: string;
  available: boolean;
  sort: CatalogSort;
  page: number;
}

type SearchParamsRecord = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parseCatalogFilters(params: SearchParamsRecord): CatalogFilters {
  const sort = firstParam(params.ordem) as CatalogSort;
  const page = Number.parseInt(firstParam(params.pagina), 10);
  return {
    q: firstParam(params.q).trim().slice(0, 100),
    category: firstParam(params.categoria).trim().slice(0, 64),
    available: firstParam(params.disponiveis) === "1",
    sort: CATALOG_SORTS.includes(sort) ? sort : "nome",
    page: Number.isFinite(page) && page > 1 ? Math.min(page, 10000) : 1,
  };
}

/** URL do catálogo com os filtros atuais e as alterações pedidas (omite valores padrão). */
export function catalogHref(
  filters: CatalogFilters,
  changes: Partial<CatalogFilters> = {},
): string {
  const next = { ...filters, ...changes };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.category) params.set("categoria", next.category);
  if (next.available) params.set("disponiveis", "1");
  if (next.sort !== "nome") params.set("ordem", next.sort);
  if (next.page > 1) params.set("pagina", String(next.page));
  const query = params.toString();
  return query ? `/catalogo?${query}` : "/catalogo";
}

// Contrato de POST /api/catalogo/pedido
export type Fulfillment = "PICKUP" | "DELIVERY";

export interface OrderRequest {
  items: { productId: string; quantity: number }[];
  customer: { name: string; note?: string; fulfillment: Fulfillment; address?: string };
}

export interface OrderLine {
  productId: string;
  name: string;
  unit: CatalogUnit;
  quantity: number;
  price: number;
  subtotal: number;
}

export interface RemovedLine {
  productId: string;
  reason: "unavailable" | "not_in_catalog";
}

export type OrderResponse =
  | {
      ok: true;
      items: OrderLine[];
      removed: RemovedLine[];
      total: number;
      whatsappUrl: string;
      message: string;
    }
  | { ok: false; error: string; removed?: RemovedLine[] };
