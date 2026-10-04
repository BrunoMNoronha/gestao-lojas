import { formatCurrency, formatNumber } from "@/lib/utils";
import { lineSubtotal, type PdvPaymentMethod } from "@/lib/offline/sale-operation";

// Rascunho do carrinho do /pdv (issue #53, docs/OFFLINE.md seção 6.3). Funções puras, sem
// IndexedDB: o formato guardado no banco do operador e a conferência do rascunho com a cópia
// local ao reabrir a página. A venda ainda não aconteceu, então valem o preço e o saldo atuais
// da cópia (a regra 3.1 de nunca recalcular vale só para venda já feita).

/** Validade do rascunho: a mesma da autorização offline (3.5). Mais velho que isso é descartado. */
export const CART_DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const INTEGER_UNITS = ["UN", "CX"];

export interface CartDraftItem {
  productId: string;
  name: string;
  unit: string;
  barcode: string | null;
  quantity: number;
  // Preço exibido ao operador quando o item entrou no carrinho
  unitPrice: number;
}

/** Carrinho em montagem, como o terminal o guarda. */
export interface CartDraftInput {
  items: CartDraftItem[];
  customer: { id: string; name: string; document: string | null } | null;
  discount: number;
  // Pagamento escolhido no "Finalizar Venda", quando a janela estava aberta
  checkout: { paymentMethod: PdvPaymentMethod; amountPaid: number } | null;
  // Chave da tentativa de venda em curso (o terminal a reaproveita enquanto o carrinho não muda)
  operation: { id: string; signature: string } | null;
}

/** Linha única do banco do operador (tabela `drafts`). */
export interface CartDraft extends CartDraftInput {
  id: typeof CART_DRAFT_ID;
  // Relógio do aparelho na última gravação (validade de 12 h)
  updatedAt: number;
}

export const CART_DRAFT_ID = "current";

/** Produto e cliente da cópia local, como o terminal os recebe. */
export interface DraftProduct {
  id: string;
  name: string;
  barcode: string | null;
  salePrice: number;
  unit: string;
  // Saldo disponível no aparelho (cópia menos as vendas da fila)
  currentStock: number;
}

export interface DraftCustomer {
  id: string;
  name: string;
  document: string | null;
}

export interface RestoredCartItem extends CartDraftItem {
  subtotal: number;
  maxStock: number;
}

export interface RestoredCart {
  items: RestoredCartItem[];
  customer: DraftCustomer | null;
  discount: number;
  // Só volta quando nada mudou: com mudanças, o operador confere o carrinho antes de pagar
  checkout: CartDraftInput["checkout"];
  operation: CartDraftInput["operation"];
}

export interface RestoreResult {
  cart: RestoredCart | null;
  // Avisos ao operador: o que mudou no carrinho, ou por que ele foi descartado
  notices: string[];
}

export const isEmptyDraft = (draft: Pick<CartDraftInput, "items" | "customer">) =>
  draft.items.length === 0 && !draft.customer;

const toCents = (value: number) => Math.round(value * 100);
const toMilli = (value: number) => Math.round(value * 1000);

const roundQuantity = (value: number, unit: string) =>
  INTEGER_UNITS.includes(unit) ? Math.floor(value + 1e-9) : toMilli(value) / 1000;

const formatQuantity = (value: number, unit: string) =>
  `${formatNumber(value, INTEGER_UNITS.includes(unit) ? 0 : 3)} ${unit}`;

/**
 * Confere o rascunho com a cópia local atual. Produto excluído sai do carrinho; preço mudado
 * passa a ser o atual; quantidade fracionada em produto vendido por unidade e quantidade acima do
 * saldo disponível são ajustadas (ou o item sai). Cada mudança gera um aviso, e qualquer mudança
 * descarta a chave da tentativa de venda: o carrinho conferido é outra venda.
 */
export function restoreCartDraft(
  draft: CartDraft | null | undefined,
  context: {
    products: DraftProduct[];
    customers: DraftCustomer[];
    paymentMethods: PdvPaymentMethod[];
    now: number;
  },
): RestoreResult {
  if (!draft) return { cart: null, notices: [] };
  if (context.now - draft.updatedAt > CART_DRAFT_MAX_AGE_MS) {
    return {
      cart: null,
      notices: ["O carrinho guardado tinha mais de 12 horas e foi descartado."],
    };
  }

  const products = new Map(context.products.map((p) => [p.id, p]));
  const notices: string[] = [];
  const items: RestoredCartItem[] = [];

  for (const saved of draft.items) {
    const product = products.get(saved.productId);
    if (!product) {
      notices.push(`"${saved.name}" saiu do carrinho: o produto não está mais disponível.`);
      continue;
    }
    const name = product.name;
    if (toCents(product.salePrice) !== toCents(saved.unitPrice)) {
      notices.push(
        `O preço de "${name}" mudou de ${formatCurrency(saved.unitPrice)} para ${formatCurrency(product.salePrice)}.`,
      );
    }

    let quantity = roundQuantity(saved.quantity, product.unit);
    if (quantity !== saved.quantity && INTEGER_UNITS.includes(product.unit)) {
      notices.push(
        quantity > 0
          ? `A quantidade de "${name}" foi ajustada para ${formatQuantity(quantity, product.unit)}: o produto é vendido só em unidades inteiras.`
          : `"${name}" saiu do carrinho: o produto é vendido só em unidades inteiras.`,
      );
      if (quantity <= 0) continue;
    }
    if (quantity > product.currentStock) {
      quantity = Math.max(0, roundQuantity(product.currentStock, product.unit));
      notices.push(
        quantity > 0
          ? `A quantidade de "${name}" foi ajustada para ${formatQuantity(quantity, product.unit)}: é o saldo disponível.`
          : `"${name}" saiu do carrinho: sem saldo disponível.`,
      );
      if (quantity <= 0) continue;
    }
    if (quantity <= 0) continue;

    items.push({
      productId: product.id,
      name,
      unit: product.unit,
      barcode: product.barcode,
      quantity,
      unitPrice: product.salePrice,
      subtotal: lineSubtotal(quantity, product.salePrice),
      maxStock: product.currentStock,
    });
  }

  let customer: DraftCustomer | null = null;
  if (draft.customer) {
    customer = context.customers.find((c) => c.id === draft.customer!.id) ?? null;
    if (!customer) {
      notices.push(
        `O cliente "${draft.customer.name}" não está mais disponível e foi removido da venda.`,
      );
    }
  }

  if (items.length === 0 && !customer) return { cart: null, notices };

  const changed = notices.length > 0;
  const checkout =
    !changed && draft.checkout && context.paymentMethods.includes(draft.checkout.paymentMethod)
      ? draft.checkout
      : null;
  return {
    cart: {
      items,
      customer,
      discount: Math.max(0, draft.discount),
      checkout,
      operation: changed ? null : draft.operation,
    },
    notices,
  };
}
