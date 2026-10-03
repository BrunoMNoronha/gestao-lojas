import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CatalogStore } from "@/lib/catalog";
import {
  MAX_ORDER_ITEMS,
  formatQuantity,
  validQuantity,
  type CatalogUnit,
  type Fulfillment,
  type OrderLine,
  type OrderRequest,
  type RemovedLine,
} from "@/lib/catalog-shared";
import { formatCurrency } from "@/lib/utils";

// Pedido do catálogo público (issue #17): valida o carrinho enviado pelo navegador, recalcula
// itens, preços e disponibilidade com o banco e monta a mensagem do WhatsApp. Não grava nada.

export type OrderBuildResult =
  | {
      ok: true;
      items: OrderLine[];
      removed: RemovedLine[];
      total: number;
      message: string;
      whatsappUrl: string;
    }
  | { ok: false; status: number; error: string; removed?: RemovedLine[] };

const MAX_NAME = 80;
const MAX_NOTE = 500;
const MAX_ADDRESS = 300;

function invalid(error: string): OrderBuildResult {
  return { ok: false, status: 400, error };
}

// Texto livre do cliente: remove caracteres de controle (exceto quebra de linha) e espaços extras
function cleanText(value: unknown, multiline = false): string {
  if (typeof value !== "string") return "";
  const pattern = multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
  return value
    .replace(pattern, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

type ParsedRequest = { ok: true; value: OrderRequest } | { ok: false; error: string };

function parseRequest(body: unknown): ParsedRequest {
  if (!body || typeof body !== "object") return { ok: false, error: "Pedido inválido." };
  const { items, customer } = body as Record<string, unknown>;

  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "O carrinho está vazio." };
  }
  if (items.length > MAX_ORDER_ITEMS) {
    return { ok: false, error: `O pedido pode ter no máximo ${MAX_ORDER_ITEMS} itens.` };
  }
  const seen = new Set<string>();
  const parsedItems: OrderRequest["items"] = [];
  for (const item of items) {
    const { productId, quantity } = (item ?? {}) as Record<string, unknown>;
    if (typeof productId !== "string" || productId.length === 0 || productId.length > 64) {
      return { ok: false, error: "Item do pedido inválido." };
    }
    if (seen.has(productId)) return { ok: false, error: "Item repetido no pedido." };
    seen.add(productId);
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, error: "A quantidade de cada item deve ser maior que zero." };
    }
    parsedItems.push({ productId, quantity });
  }

  if (!customer || typeof customer !== "object") {
    return { ok: false, error: "Informe seus dados para enviar o pedido." };
  }
  const raw = customer as Record<string, unknown>;
  const name = cleanText(raw.name);
  if (name.length < 2 || name.length > MAX_NAME) {
    return { ok: false, error: "Informe seu nome (2 a 80 caracteres)." };
  }
  const note = cleanText(raw.note, true);
  if (note.length > MAX_NOTE) {
    return { ok: false, error: `A observação pode ter no máximo ${MAX_NOTE} caracteres.` };
  }
  if (raw.fulfillment !== "PICKUP" && raw.fulfillment !== "DELIVERY") {
    return { ok: false, error: "Escolha retirada na loja ou entrega." };
  }
  const fulfillment: Fulfillment = raw.fulfillment;
  const address = fulfillment === "DELIVERY" ? cleanText(raw.address, true) : "";
  if (fulfillment === "DELIVERY" && (address.length < 5 || address.length > MAX_ADDRESS)) {
    return { ok: false, error: "Informe o endereço de entrega (5 a 300 caracteres)." };
  }

  return {
    ok: true,
    value: {
      items: parsedItems,
      customer: { name, note: note || undefined, fulfillment, address: address || undefined },
    },
  };
}

function buildMessage(
  store: CatalogStore,
  items: OrderLine[],
  total: number,
  customer: OrderRequest["customer"],
) {
  const lines = [`Olá! Gostaria de fazer um pedido pelo catálogo da *${store.name}*:`, ""];
  items.forEach((item, index) => {
    lines.push(`${index + 1}. *${item.name}*`);
    lines.push(
      `   ${formatQuantity(item.unit, item.quantity)} ${item.unit} × ${formatCurrency(item.price)} = ${formatCurrency(item.subtotal)}`,
    );
  });
  lines.push("", `*Total estimado: ${formatCurrency(total)}*`, "");
  lines.push(`*Cliente:* ${customer.name}`);
  lines.push(
    `*Recebimento:* ${customer.fulfillment === "DELIVERY" ? "Entrega" : "Retirada na loja"}`,
  );
  if (customer.address) lines.push(`*Endereço:* ${customer.address}`);
  if (customer.note) lines.push(`*Observação:* ${customer.note}`);
  lines.push("", "_Preços e disponibilidade sujeitos a confirmação._");
  return lines.join("\n");
}

export async function buildCatalogOrder(
  body: unknown,
  store: CatalogStore,
): Promise<OrderBuildResult> {
  if (!store.whatsappNumber) {
    return { ok: false, status: 409, error: "O WhatsApp da loja ainda não foi configurado." };
  }

  const parsed = parseRequest(body);
  if (!parsed.ok) return invalid(parsed.error);
  const { items: requested, customer } = parsed.value;

  const products = await prisma.product.findMany({
    where: { id: { in: requested.map((item) => item.productId) }, deletedAt: null },
    select: {
      id: true,
      name: true,
      salePrice: true,
      unit: true,
      currentStock: true,
      showInCatalog: true,
    },
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  const items: OrderLine[] = [];
  const removed: RemovedLine[] = [];
  let total = new Prisma.Decimal(0);

  for (const { productId, quantity } of requested) {
    const product = byId.get(productId);
    if (!product || !product.showInCatalog) {
      removed.push({ productId, reason: "not_in_catalog" });
      continue;
    }
    if (product.currentStock.lte(0)) {
      removed.push({ productId, reason: "unavailable" });
      continue;
    }
    const unit = product.unit as CatalogUnit;
    const validated = validQuantity(unit, quantity);
    if (validated === null) {
      return invalid(
        unit === "UN" || unit === "CX"
          ? `A quantidade de "${product.name}" deve ser um número inteiro.`
          : `A quantidade de "${product.name}" aceita até 3 casas decimais.`,
      );
    }
    const qty = new Prisma.Decimal(validated);
    const subtotal = product.salePrice.mul(qty).toDecimalPlaces(2);
    total = total.add(subtotal);
    items.push({
      productId,
      name: product.name,
      unit,
      quantity: validated,
      price: product.salePrice.toNumber(),
      subtotal: subtotal.toNumber(),
    });
  }

  if (items.length === 0) {
    return {
      ok: false,
      status: 422,
      error: "Nenhum item do carrinho está disponível no catálogo.",
      removed,
    };
  }

  const totalNumber = total.toDecimalPlaces(2).toNumber();
  const message = buildMessage(store, items, totalNumber, customer);
  return {
    ok: true,
    items,
    removed,
    total: totalNumber,
    message,
    whatsappUrl: `https://wa.me/${store.whatsappNumber}?text=${encodeURIComponent(message)}`,
  };
}
