import { getCatalogStore } from "@/lib/catalog";
import { buildCatalogOrder } from "@/lib/catalog-order";
import type { OrderResponse, RemovedLine } from "@/lib/catalog-shared";

// POST público do catálogo (#17): recebe o carrinho e os dados do cliente, recalcula com o banco
// e devolve a mensagem e a URL do WhatsApp. Não exige sessão e não grava nada: a mensagem leva o
// link do pedido (issue #81), que só gera o pedido quando um usuário logado o abre.
const MAX_BODY_BYTES = 32 * 1024;

// Origem pública do site para o link do pedido. `request.url` traz o endereço em que o servidor
// escuta (ex.: 0.0.0.0 no container), não o que o cliente acessou: vale AUTH_URL, se definida, ou o
// host repassado pelo proxy (Vercel) ou pelo navegador.
function siteOrigin(request: Request): string {
  const configured = process.env.AUTH_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // AUTH_URL inválida: segue para os cabeçalhos
    }
  }
  const first = (value: string | null) => value?.split(",")[0]?.trim() || null;
  const host = first(request.headers.get("x-forwarded-host")) ?? first(request.headers.get("host"));
  const proto =
    first(request.headers.get("x-forwarded-proto")) ?? new URL(request.url).protocol.slice(0, -1);
  if (host && /^[A-Za-z0-9.-]+(:\d+)?$|^\[[0-9a-fA-F:]+\](:\d+)?$/.test(host)) {
    return `${proto === "http" ? "http" : "https"}://${host}`;
  }
  return new URL(request.url).origin;
}

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
    const result = await buildCatalogOrder(body, store, siteOrigin(request));
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
