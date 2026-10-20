import { openText, sealText } from "@/lib/secret-box";
import { MAX_ITEM_QUANTITY, MAX_ORDER_ITEMS } from "@/lib/catalog-shared";
import { normalizePhone } from "@/lib/masks";

// Link do pedido do catálogo (issue #81), usado só no servidor. Vai na mensagem do WhatsApp com
// os itens, a chave da solicitação e o contato (nome e telefone), criptografados com AES-256-GCM:
// quem vê a URL não lê o contato nem consegue alterar nada (o tag do GCM recusa o token mexido).
// A chave é derivada do AUTH_SECRET (src/lib/secret-box.ts); trocá-lo invalida os links ainda não
// abertos.

export interface OrderLinkData {
  key: string;
  items: { productId: string; quantity: number }[];
  contact: { name: string; phone: string };
}

const LINK_BOX = { info: "catalog-order-link-v2", version: 2 };
const MAX_TOKEN_LENGTH = 12 * 1024;
const MAX_NAME = 80;
const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function encodeOrderLink({ key, items, contact }: OrderLinkData): string {
  const plain = JSON.stringify({
    k: key,
    i: items.map((item) => [item.productId, item.quantity]),
    c: { n: contact.name, p: contact.phone },
  });
  return sealText(plain, LINK_BOX);
}

function decrypt(token: string): unknown {
  const plain = openText(token, LINK_BOX);
  if (plain === null) return null;
  try {
    return JSON.parse(plain);
  } catch {
    return null;
  }
}

/** Link do pedido descriptografado e validado; null se inválido, adulterado ou de outra chave. */
export function decodeOrderLink(token: unknown): OrderLinkData | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const raw = decrypt(token);
  if (!raw || typeof raw !== "object") return null;
  const { k, i, c } = raw as Record<string, unknown>;
  if (typeof k !== "string" || !KEY_RE.test(k)) return null;
  if (!Array.isArray(i) || i.length === 0 || i.length > MAX_ORDER_ITEMS) return null;

  const seen = new Set<string>();
  const items: OrderLinkData["items"] = [];
  for (const entry of i) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [productId, quantity] = entry as unknown[];
    if (typeof productId !== "string" || !ID_RE.test(productId) || seen.has(productId)) {
      return null;
    }
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) return null;
    if (quantity > MAX_ITEM_QUANTITY || Math.round(quantity * 1000) / 1000 !== quantity) {
      return null;
    }
    seen.add(productId);
    items.push({ productId, quantity });
  }

  if (!c || typeof c !== "object") return null;
  const { n, p } = c as Record<string, unknown>;
  if (typeof n !== "string" || n.trim().length < 2 || n.length > MAX_NAME) return null;
  const phone = normalizePhone(typeof p === "string" ? p : "");
  if (!phone.ok || !phone.value) return null;

  return { key: k, items, contact: { name: n.trim(), phone: phone.value } };
}
