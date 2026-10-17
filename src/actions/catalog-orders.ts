"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type CatalogOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/authz";
import { PAGE_SIZE, pageNumber } from "@/lib/pagination";
import { getPdvProducts } from "@/actions/browse";
import type { PdvCustomer, PdvProduct } from "@/components/pdv-terminal";
import { createCatalogOrderFromLink } from "@/lib/catalog-order";
import { CATALOG_ORDER_CLOSED_ERROR } from "@/lib/catalog-shared";
import { formatCurrency, formatNumber } from "@/lib/utils";

// Pedidos do catálogo no painel (issue #81). O pedido nasce quando um usuário logado abre o link
// da mensagem do WhatsApp; só operadores habilitados ao PDV geram, consultam, cancelam ou carregam
// pedidos. Nenhum dado pessoal é gravado (fica na conversa). A conclusão é a própria venda
// (createSale com catalogOrderId), que grava o vínculo na mesma transação da baixa de estoque.

export interface CatalogOrderListItem {
  id: string;
  code: number;
  createdAt: string;
  createdByName: string;
  customerName: string | null;
  estimatedTotal: number;
  status: CatalogOrderStatus;
  itemCount: number;
  saleCode: number | null;
}

export interface CatalogOrderDetail extends CatalogOrderListItem {
  // Telefone só com dígitos (DDD + número), como informado no carrinho
  customerPhone: string | null;
  // Cliente cadastrado com o mesmo telefone, vinculado ao gerar o pedido
  customer: { id: string; name: string; deleted: boolean } | null;
  items: {
    id: string;
    productName: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    productDeleted: boolean;
  }[];
  canceled: { at: string; byName: string | null; reason: string | null } | null;
  converted: { at: string; byName: string | null; saleCode: number | null } | null;
}

export interface CatalogOrderForPdv {
  id: string;
  code: number;
  customerName: string | null;
  customerPhone: string | null;
  // Cliente vinculado e ativo, já selecionado no PDV
  customer: PdvCustomer | null;
  // Itens com o produto atual (preço e estoque de agora), prontos para o carrinho
  lines: { product: PdvProduct; quantity: number }[];
  // O que mudou desde o pedido; o operador vê antes de concluir a venda
  notices: string[];
}

export type CatalogOrderActionResult = { success: true } | { success: false; error: string };

const STATUSES: CatalogOrderStatus[] = ["OPEN", "CANCELED", "CONVERTED"];
const CANCEL_REASON_MAX = 300;
const ALREADY_CLOSED = CATALOG_ORDER_CLOSED_ERROR;

function parseStatus(value: unknown): CatalogOrderStatus | undefined {
  return STATUSES.find((status) => status === value);
}

const listSelect = {
  id: true,
  code: true,
  createdAt: true,
  createdBy: { select: { name: true } },
  customerName: true,
  estimatedTotal: true,
  status: true,
  sale: { select: { code: true } },
  _count: { select: { items: true } },
} satisfies Prisma.CatalogOrderSelect;

function toListItem(
  order: Prisma.CatalogOrderGetPayload<{ select: typeof listSelect }>,
): CatalogOrderListItem {
  return {
    id: order.id,
    code: order.code,
    createdAt: order.createdAt.toISOString(),
    createdByName: order.createdBy.name,
    customerName: order.customerName,
    estimatedTotal: order.estimatedTotal.toNumber(),
    status: order.status,
    itemCount: order._count.items,
    saleCode: order.sale?.code ?? null,
  };
}

export async function getCatalogOrderPage(filters: { status?: string; page?: number } = {}) {
  const authz = await authorize("pdv.use");
  const page = pageNumber(filters.page);
  if (!authz.ok) return { items: [] as CatalogOrderListItem[], total: 0, page: 1, failed: false };
  try {
    const status = parseStatus(filters.status);
    const where: Prisma.CatalogOrderWhereInput = status ? { status } : {};
    const [total, rows] = await Promise.all([
      prisma.catalogOrder.count({ where }),
      prisma.catalogOrder.findMany({
        where,
        select: listSelect,
        orderBy: [{ createdAt: "desc" }, { code: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);
    return { items: rows.map(toListItem), total, page, failed: false };
  } catch (error) {
    console.error("Erro ao consultar pedidos do catálogo:", error);
    return { items: [] as CatalogOrderListItem[], total: 0, page, failed: true };
  }
}

export async function getCatalogOrderDetail(id: string): Promise<CatalogOrderDetail | null> {
  try {
    const authz = await authorize("pdv.use");
    if (!authz.ok || typeof id !== "string" || !id) return null;
    const order = await prisma.catalogOrder.findUnique({
      where: { id },
      select: {
        ...listSelect,
        customerPhone: true,
        customer: { select: { id: true, name: true, deletedAt: true } },
        canceledAt: true,
        cancelReason: true,
        canceledBy: { select: { name: true } },
        convertedAt: true,
        convertedBy: { select: { name: true } },
        items: {
          select: {
            id: true,
            productName: true,
            unit: true,
            quantity: true,
            unitPrice: true,
            subtotal: true,
            product: { select: { deletedAt: true } },
          },
          orderBy: { id: "asc" },
        },
      },
    });
    if (!order) return null;
    return {
      ...toListItem(order),
      customerPhone: order.customerPhone,
      customer: order.customer && {
        id: order.customer.id,
        name: order.customer.name,
        deleted: order.customer.deletedAt !== null,
      },
      items: order.items.map((item) => ({
        id: item.id,
        productName: item.productName,
        unit: item.unit,
        quantity: item.quantity.toNumber(),
        unitPrice: item.unitPrice.toNumber(),
        subtotal: item.subtotal.toNumber(),
        productDeleted: !item.product || item.product.deletedAt !== null,
      })),
      canceled: order.canceledAt
        ? {
            at: order.canceledAt.toISOString(),
            byName: order.canceledBy?.name ?? null,
            reason: order.cancelReason,
          }
        : null,
      converted: order.convertedAt
        ? {
            at: order.convertedAt.toISOString(),
            byName: order.convertedBy?.name ?? null,
            saleCode: order.sale?.code ?? null,
          }
        : null,
    };
  } catch (error) {
    console.error("Erro ao buscar detalhe do pedido do catálogo:", error);
    return null;
  }
}

/**
 * Cancela um pedido disponível. A troca de estado é condicional (status OPEN): se a venda do
 * pedido for concluída ao mesmo tempo, só uma das duas operações vale.
 */
export async function cancelCatalogOrder(input: {
  id: string;
  reason?: string;
}): Promise<CatalogOrderActionResult> {
  const authz = await authorize("pdv.use");
  if (!authz.ok) return { success: false, error: authz.error };
  if (!input || typeof input.id !== "string" || !input.id) {
    return { success: false, error: "Pedido inválido." };
  }
  const reason =
    typeof input.reason === "string"
      ? input.reason.replace(/\s+/g, " ").trim().slice(0, CANCEL_REASON_MAX)
      : "";
  try {
    const claimed = await prisma.catalogOrder.updateMany({
      where: { id: input.id, status: "OPEN", saleId: null },
      data: {
        status: "CANCELED",
        canceledAt: new Date(),
        canceledById: authz.user.id,
        cancelReason: reason || null,
      },
    });
    if (claimed.count === 0) {
      const exists = await prisma.catalogOrder.count({ where: { id: input.id } });
      return { success: false, error: exists ? ALREADY_CLOSED : "Pedido não encontrado." };
    }
    revalidatePath("/admin/pedidos");
    return { success: true };
  } catch (error) {
    console.error("Erro ao cancelar pedido do catálogo:", error);
    return { success: false, error: "Falha ao cancelar o pedido no banco de dados." };
  }
}

const quantityText = (unit: string, value: number) =>
  `${formatNumber(value, unit === "UN" || unit === "CX" ? 0 : 3)} ${unit}`;

/**
 * Pedido disponível pronto para o carrinho do PDV, revalidado com o cadastro atual: preço de
 * agora, produto excluído ou sem estoque fora do carrinho e quantidade limitada ao saldo. Cada
 * diferença vira um aviso para o operador conferir antes de concluir a venda.
 */
export async function getCatalogOrderForPdv(
  id: string,
): Promise<{ ok: true; order: CatalogOrderForPdv } | { ok: false; error: string }> {
  const authz = await authorize("pdv.use");
  if (!authz.ok) return { ok: false, error: authz.error };
  if (typeof id !== "string" || !id) return { ok: false, error: "Pedido inválido." };
  try {
    const order = await prisma.catalogOrder.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        status: true,
        customerName: true,
        customerPhone: true,
        customer: {
          select: { id: true, name: true, document: true, phone: true, deletedAt: true },
        },
        items: {
          select: {
            productId: true,
            productName: true,
            unit: true,
            quantity: true,
            unitPrice: true,
          },
          orderBy: { id: "asc" },
        },
      },
    });
    if (!order) return { ok: false, error: "Pedido não encontrado." };
    if (order.status !== "OPEN") return { ok: false, error: ALREADY_CLOSED };

    const ids = order.items.flatMap((item) => (item.productId ? [item.productId] : []));
    const products = ids.length > 0 ? await getPdvProducts("", ids) : [];
    const catalog = new Map(
      (
        await prisma.product.findMany({
          where: { id: { in: ids } },
          select: { id: true, showInCatalog: true },
        })
      ).map((p) => [p.id, p.showInCatalog]),
    );
    const byId = new Map(products.map((product) => [product.id, product]));

    const lines: CatalogOrderForPdv["lines"] = [];
    const notices: string[] = [];
    for (const item of order.items) {
      const product = item.productId ? byId.get(item.productId) : undefined;
      if (!product) {
        notices.push(`${item.productName}: produto excluído do cadastro, não foi carregado.`);
        continue;
      }
      const ordered = item.quantity.toNumber();
      if (product.currentStock <= 0) {
        notices.push(`${product.name}: sem estoque, não foi carregado.`);
        continue;
      }
      let quantity = ordered;
      if (product.currentStock < ordered) {
        // Unidade inteira não aceita fração do saldo
        quantity =
          product.unit === "UN" || product.unit === "CX"
            ? Math.floor(product.currentStock)
            : product.currentStock;
        if (quantity <= 0) {
          notices.push(`${product.name}: sem estoque suficiente, não foi carregado.`);
          continue;
        }
        notices.push(
          `${product.name}: pedido ${quantityText(product.unit, ordered)}, estoque permite ${quantityText(product.unit, quantity)}.`,
        );
      }
      const orderedPrice = item.unitPrice.toNumber();
      if (orderedPrice !== product.salePrice) {
        notices.push(
          `${product.name}: preço alterado de ${formatCurrency(orderedPrice)} para ${formatCurrency(product.salePrice)}.`,
        );
      }
      if (catalog.get(product.id) === false) {
        notices.push(`${product.name}: saiu do catálogo, mas foi carregado.`);
      }
      lines.push({ product, quantity });
    }

    // Cliente excluído depois do pedido não é selecionado no PDV
    const customer =
      order.customer && !order.customer.deletedAt
        ? {
            id: order.customer.id,
            name: order.customer.name,
            document: order.customer.document,
            phone: order.customer.phone,
          }
        : null;
    return {
      ok: true,
      order: {
        id: order.id,
        code: order.code,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customer,
        lines,
        notices,
      },
    };
  } catch (error) {
    console.error("Erro ao carregar pedido do catálogo no PDV:", error);
    return { ok: false, error: "Não foi possível carregar o pedido agora." };
  }
}

/**
 * Gera o pedido a partir do link da mensagem do WhatsApp, aberto por um usuário logado. Abrir o
 * mesmo link de novo devolve o mesmo pedido (a chave do link é única no banco).
 */
export async function registerCatalogOrderFromLink(
  token: string,
): Promise<{ success: true; id: string; code: number } | { success: false; error: string }> {
  const authz = await authorize("pdv.use");
  if (!authz.ok) return { success: false, error: authz.error };
  try {
    const result = await createCatalogOrderFromLink(authz.user.id, token);
    if (!result.ok) return { success: false, error: result.error };
    if (!result.replayed) revalidatePath("/admin/pedidos");
    return { success: true, id: result.id, code: result.code };
  } catch (error) {
    console.error("Erro ao gerar pedido pelo link do catálogo:", error);
    return { success: false, error: "Não foi possível registrar o pedido agora." };
  }
}
