import type { SessionUser } from "@/lib/authz";
import type { OfflinePreparation } from "@/lib/offline-device";
import { withPdvStockLock } from "@/lib/offline/stock-lock";
import type { OfflineSnapshot } from "@/lib/offline-snapshot";
import {
  applySnapshotPage,
  getDevice,
  readMeta,
  savePreparation,
  userDb,
  type LocalMeta,
} from "@/lib/offline/db";

// Comunicação do PDV offline com o servidor (issue #37, docs/OFFLINE.md seção 5). Só roda no
// navegador. Usa os Route Handlers de /api/offline, que continuam válidos depois de um deploy.

/** Dados guardados pelo prazo máximo de 24 horas (docs/OFFLINE.md seção 3.5). */
export const MAX_DATA_AGE_MS = 24 * 60 * 60 * 1000;
const PING_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 20_000;

export type Connectivity =
  | { status: "online"; user: SessionUser }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  // Sem rede, servidor fora do ar, tempo esgotado ou banco indisponível (503)
  | { status: "unreachable" };

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Conectividade real com o serviço (não depende de navigator.onLine). */
export async function checkConnectivity(): Promise<Connectivity> {
  try {
    const res = await fetchWithTimeout("/api/offline/ping", {}, PING_TIMEOUT_MS);
    if (res.status === 401) return { status: "unauthenticated" };
    if (res.status === 403) return { status: "forbidden" };
    if (!res.ok) return { status: "unreachable" };
    const body = (await res.json()) as { user: SessionUser };
    return { status: "online", user: body.user };
  } catch {
    return { status: "unreachable" };
  }
}

/** Erro de uma chamada ao servidor, com o código da resposta quando houver. */
export class OfflineRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function readError(res: Response, fallback: string): Promise<OfflineRequestError> {
  const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  return new OfflineRequestError(body?.error ?? fallback, res.status, body?.code);
}

/** Nome legível do aparelho para a lista do servidor (ex.: "Chrome · Windows"). */
function describeDevice(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Navegador";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "Sistema desconhecido";
  return `${browser} · ${os}`;
}

/**
 * Baixa a cópia local: carga completa sem cursor, ou só as alterações a partir do último cursor.
 * Pede as páginas seguintes enquanto houver `hasMore`. Cada página é aplicada numa transação.
 */
export function syncSnapshot(userId: string, { full = false, stockLockHeld = false } = {}) {
  return stockLockHeld
    ? syncSnapshotUnlocked(userId, full)
    : withPdvStockLock(userId, () => syncSnapshotUnlocked(userId, full));
}

async function syncSnapshotUnlocked(userId: string, full: boolean) {
  const db = userDb(userId);
  let cursor = full ? null : ((await readMeta(db, "sync"))?.cursor ?? null);
  for (;;) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    let res: Response;
    try {
      res = await fetchWithTimeout(`/api/offline/snapshot${query}`, {}, REQUEST_TIMEOUT_MS);
    } catch {
      throw new OfflineRequestError("Sem conexão com o servidor.", null);
    }
    if (!res.ok) throw await readError(res, "Não foi possível sincronizar agora.");
    const page = (await res.json()) as OfflineSnapshot;
    if (page.user.id !== userId) {
      throw new OfflineRequestError("A sessão mudou de usuário. Recarregue a página.", 409);
    }
    await applySnapshotPage(db, page);
    if (!page.hasMore) return;
    cursor = page.cursor;
  }
}

/**
 * Preparação online explícita (docs/OFFLINE.md seção 7): registra o aparelho, recebe a
 * autorização offline de 12 horas, pede armazenamento persistente e baixa a cópia completa.
 */
export async function prepareDevice(userId: string): Promise<OfflinePreparation> {
  const device = await getDevice();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      "/api/offline/prepare",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: device.id, deviceName: describeDevice() }),
      },
      REQUEST_TIMEOUT_MS,
    );
  } catch {
    throw new OfflineRequestError("Sem conexão com o servidor.", null);
  }
  if (!res.ok) throw await readError(res, "Não foi possível preparar o aparelho.");
  const prep = (await res.json()) as OfflinePreparation;
  if (prep.user.id !== userId) {
    throw new OfflineRequestError("A sessão mudou de usuário. Recarregue a página.", 409);
  }

  // Sem armazenamento persistente, o navegador pode apagar os dados sob pouco espaço
  const persisted = (await navigator.storage?.persist?.().catch(() => false)) ?? false;
  await savePreparation(prep, persisted);
  await syncSnapshot(userId, { full: true });
  return prep;
}

export type OfflineBlock =
  "not_prepared" | "incomplete" | "grant_expired" | "stale" | "cash_mismatch";

/**
 * O PDV pode abrir sem rede? Usa o relógio do aparelho só para bloquear localmente (quem decide
 * no servidor são os instantes que ele emitiu). Devolve o motivo do bloqueio ou null.
 */
export function offlineBlock(
  meta: Partial<Pick<LocalMeta, "grant" | "sync" | "cashRegister">>,
  now = Date.now(),
): OfflineBlock | null {
  if (!meta.grant) return "not_prepared";
  if (!meta.sync?.complete || !meta.sync.syncedAt) return "incomplete";
  if (new Date(meta.grant.expiresAt).getTime() <= now) return "grant_expired";
  if (now - meta.sync.syncedAt > MAX_DATA_AGE_MS) return "stale";
  // O caixa do turno preparado precisa ser o caixa aberto da última sincronização
  if (meta.cashRegister?.id !== meta.grant.cashRegisterId) return "cash_mismatch";
  return null;
}
