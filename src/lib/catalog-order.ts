import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CatalogStore } from "@/lib/catalog";
import {
  MAX_ORDER_ITEMS,
  ORDER_LINK_PATH,
  formatQuantity,
  mapsUrl,
  parseGeoPoint,
  validQuantity,
  type CatalogUnit,
  type Fulfillment,
  type OrderLine,
  type OrderRequest,
  type RemovedLine,
} from "@/lib/catalog-shared";
import { formatPhone, normalizePhone } from "@/lib/masks";
import { decodeOrderLink, encodeOrderLink, type OrderLinkData } from "@/lib/order-link";
import { hashPayload } from "@/lib/sync-operation";
import { formatCurrency } from "@/lib/utils";

// Pedido do catálogo público (issues #17 e #81): valida o carrinho enviado pelo navegador,
// recalcula itens, preços e disponibilidade com o banco e monta a mensagem do WhatsApp, que leva o
// link do pedido. buildCatalogOrder (público) não grava nada. createCatalogOrderFromLink registra o
// pedido quando um usuário logado abre o link, de forma idempotente pela chave do link. Nenhum dos
// dois mexe em estoque, caixa ou vendas.

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

export type OrderFromLinkResult =
  | { ok: true; id: string; code: number; replayed: boolean }
  | { ok: false; status: number; error: string };

const MAX_NAME = 80;
const MAX_NOTE = 500;
const MAX_ADDRESS = 300;

function invalid(error: string): { ok: false; status: number; error: string } {
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
  const phone = normalizePhone(typeof raw.phone === "string" ? raw.phone : "");
  if (!phone.ok || !phone.value) {
    return { ok: false, error: "Informe um telefone com DDD, ex.: (11) 99999-8888." };
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
  // GPS é opcional e só faz sentido na entrega
  const location = fulfillment === "DELIVERY" ? parseGeoPoint(raw.location) : null;
  if (location === "invalid") return { ok: false, error: "Localização inválida." };

  return {
    ok: true,
    value: {
      items: parsedItems,
      customer: {
        name,
        phone: phone.value,
        note: note || undefined,
        fulfillment,
        address: address || undefined,
        location: location ?? undefined,
      },
    },
  };
}

// Texto da mensagem do WhatsApp. O link do pedido não afirma registro, envio nem leitura: o pedido
// só existe no sistema quando a loja abre o link.
export function buildMessage(
  store: Pick<CatalogStore, "name">,
  items: OrderLine[],
  total: number,
  customer: OrderRequest["customer"],
  orderLink?: string,
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
  lines.push(`*Telefone:* ${formatPhone(customer.phone)}`);
  lines.push(
    `*Recebimento:* ${customer.fulfillment === "DELIVERY" ? "Entrega" : "Retirada na loja"}`,
  );
  if (customer.address) lines.push(`*Endereço:* ${customer.address}`);
  if (customer.location) {
    const { accuracy } = customer.location;
    const precision = accuracy !== undefined ? ` (precisão ~${accuracy} m)` : "";
    lines.push(`*Localização:* ${mapsUrl(customer.location)}${precision}`);
  }
  if (customer.note) lines.push(`*Observação:* ${customer.note}`);
  if (orderLink) lines.push("", `*Link do pedido:* ${orderLink}`);
  lines.push("", "_Preços e disponibilidade sujeitos a confirmação._");
  return lines.join("\n");
}

function whatsappUrlFor(store: CatalogStore, message: string) {
  return `https://wa.me/${store.whatsappNumber}?text=${encodeURIComponent(message)}`;
}

type PricedOrder =
  | { ok: true; items: OrderLine[]; removed: RemovedLine[]; total: number }
  | { ok: false; status: number; error: string; removed?: RemovedLine[] };

// Recalcula com o banco: fora do catálogo ou sem estoque sai do pedido; quantidade inválida recusa.
async function priceOrder(requested: OrderRequest["items"]): Promise<PricedOrder> {
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

  return { ok: true, items, removed, total: total.toDecimalPlaces(2).toNumber() };
}

/**
 * Prévia pública do pedido. `origin` é a origem do site (da própria requisição), usada no link do
 * pedido. Cada prévia ganha uma chave nova: a mesma mensagem aberta duas vezes vira um só pedido.
 */
export async function buildCatalogOrder(
  body: unknown,
  store: CatalogStore,
  origin?: string,
): Promise<OrderBuildResult> {
  if (!store.whatsappNumber) {
    return { ok: false, status: 409, error: "O WhatsApp da loja ainda não foi configurado." };
  }

  const parsed = parseRequest(body);
  if (!parsed.ok) return invalid(parsed.error);
  const { items: requested, customer } = parsed.value;

  const priced = await priceOrder(requested);
  if (!priced.ok) return priced;
  const { items, removed, total } = priced;
  const token = encodeOrderLink({
    key: randomUUID(),
    items: items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    contact: { name: customer.name, phone: customer.phone },
  });
  const orderLink = origin ? `${origin}${ORDER_LINK_PATH}?p=${token}` : undefined;
  const message = buildMessage(store, items, total, customer, orderLink);
  return { ok: true, items, removed, total, message, whatsappUrl: whatsappUrlFor(store, message) };
}

// Hash dos itens (em ordem estável) e do contato do link: a mesma chave só vale para os mesmos dados
function linkHash({ items, contact }: OrderLinkData): string {
  return hashPayload({
    v: 2,
    items: [...items]
      .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0))
      .map((item) => [item.productId, String(item.quantity)]),
    contact: [contact.name, contact.phone],
  });
}

// Cliente cadastrado com o mesmo telefone; com nenhum ou mais de um, o pedido fica sem vínculo
async function customerByPhone(phone: string): Promise<string | null> {
  const matches = await prisma.customer.findMany({
    where: { phone, deletedAt: null },
    select: { id: true },
    take: 2,
  });
  return matches.length === 1 ? matches[0].id : null;
}

function isDuplicateRequest(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    error.meta?.modelName === "CatalogOrder"
  );
}

// Pedido já gerado com a mesma chave: mesmos itens devolvem o mesmo pedido; outros, recusa
async function replayOrder(key: string, payloadHash: string): Promise<OrderFromLinkResult | null> {
  const order = await prisma.catalogOrder.findUnique({
    where: { requestKey: key },
    select: { id: true, code: true, payloadHash: true },
  });
  if (!order) return null;
  if (order.payloadHash !== payloadHash) {
    return { ok: false, status: 409, error: "Este link de pedido foi alterado e não é válido." };
  }
  return { ok: true, id: order.id, code: order.code, replayed: true };
}

/**
 * Gera o pedido a partir do link da mensagem (issue #81), para o usuário já autorizado. Abrir o
 * mesmo link de novo, inclusive ao mesmo tempo, devolve o mesmo pedido. Itens fora do catálogo ou
 * sem estoque ficam de fora; preços são os de agora.
 */
export async function createCatalogOrderFromLink(
  userId: string,
  token: unknown,
): Promise<OrderFromLinkResult> {
  const link = decodeOrderLink(token);
  if (!link) return { ok: false, status: 400, error: "Link de pedido inválido." };
  const payloadHash = linkHash(link);

  const previous = await replayOrder(link.key, payloadHash);
  if (previous) return previous;

  const priced = await priceOrder(link.items);
  if (!priced.ok) return { ok: false, status: priced.status, error: priced.error };
  const customerId = await customerByPhone(link.contact.phone);

  try {
    const order = await prisma.catalogOrder.create({
      data: {
        requestKey: link.key,
        payloadHash,
        createdById: userId,
        customerName: link.contact.name,
        customerPhone: link.contact.phone,
        customerId,
        estimatedTotal: priced.total,
        items: {
          create: priced.items.map((item) => ({
            productId: item.productId,
            productName: item.name,
            unit: item.unit,
            quantity: item.quantity,
            unitPrice: item.price,
            subtotal: item.subtotal,
          })),
        },
      },
      select: { id: true, code: true },
    });
    return { ok: true, id: order.id, code: order.code, replayed: false };
  } catch (error) {
    // Duas aberturas simultâneas do mesmo link: a segunda devolve o pedido da primeira
    if (isDuplicateRequest(error)) {
      const replay = await replayOrder(link.key, payloadHash);
      if (replay) return replay;
    }
    throw error;
  }
}
