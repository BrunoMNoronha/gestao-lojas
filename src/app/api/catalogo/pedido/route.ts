import { getCatalogStore } from "@/lib/catalog";
import { buildCatalogOrder } from "@/lib/catalog-order";
import type { OrderResponse, RemovedLine } from "@/lib/catalog-shared";

// POST público do catálogo (#17): recebe o carrinho e os dados do cliente, recalcula com o banco
// e devolve a mensagem e a URL do WhatsApp. Não exige sessão e não grava nada.
const MAX_BODY_BYTES = 32 * 1024;

function fail(status: number, error: string, removed?: RemovedLine[]) {
  return Response.json({ ok: false, error, removed } satisfies OrderResponse, { status });
}

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return fail(413, "Pedido grande demais.");

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return fail(413, "Pedido grande demais.");
    body = JSON.parse(raw);
  } catch {
    return fail(400, "Pedido inválido.");
  }

  const store = await getCatalogStore();
  if (!store) return fail(503, "Catálogo indisponível no momento. Tente novamente em instantes.");
  if (!store.enabled) return fail(404, "Catálogo indisponível.");

  try {
    const result = await buildCatalogOrder(body, store);
    if (!result.ok) return fail(result.status, result.error, result.removed);
    const { ok, items, removed, total, whatsappUrl, message } = result;
    return Response.json({
      ok,
      items,
      removed,
      total,
      whatsappUrl,
      message,
    } satisfies OrderResponse);
  } catch (error) {
    console.error("Erro ao montar o pedido do catálogo:", error);
    return fail(503, "Não foi possível montar o pedido agora. Tente novamente em instantes.");
  }
}
