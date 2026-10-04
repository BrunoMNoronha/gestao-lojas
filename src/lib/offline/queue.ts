import {
  readMeta,
  refreshPendingCount,
  userDb,
  type LocalOperation,
  type LocalOperationStatus,
} from "@/lib/offline/db";
import {
  buildSaleOperation,
  newLocalOperation,
  prunableOperationIds,
  SaleDraftError,
  type PdvSaleDraft,
} from "@/lib/offline/sale-operation";
import { offlineBlock } from "@/lib/offline/sync";

// Fila de vendas do /pdv (issue #38, docs/OFFLINE.md seções 4 e 5). Só roda no navegador.
// A venda é gravada no IndexedDB antes de o recibo aparecer e enviada pelo
// POST /api/offline/operations, com conexão: logo depois da venda, a cada checagem de conexão e
// pelo botão "Sincronizar". Reenviar é sempre seguro: o servidor devolve o resultado já gravado
// para a mesma chave (idempotência da #35).

const OPERATIONS_URL = "/api/offline/operations";
const MAX_BATCH = 50; // MAX_OPERATIONS_PER_BATCH do servidor
const REQUEST_TIMEOUT_MS = 30_000;
// Conflito só muda quando um gerente decide: a consulta automática é espaçada
const CONFLICT_POLL_MS = 5 * 60_000;

const SENDABLE: LocalOperationStatus[] = ["pending", "syncing", "failed", "conflict"];

/**
 * Registra a venda na fila do operador. Confere a preparação (autorização válida, dados com até
 * 24 h, caixa da autorização) com o relógio do aparelho, só para bloquear localmente. Falha de
 * gravação ou de cota sobe como erro: a venda não é confirmada e o carrinho fica como está.
 */
export async function recordSale(userId: string, draft: PdvSaleDraft): Promise<LocalOperation> {
  const db = userDb(userId);

  // Nova tentativa da mesma venda (o terminal reaproveita a chave enquanto o carrinho não muda),
  // ex.: a gravação deu certo e algo falhou depois. Devolve a venda já gravada; com outros dados,
  // a chave é recusada (nunca sobrescreve).
  const existing = await db.operations.get(draft.operationId);
  if (existing) {
    const { request } = buildSaleOperation(draft, {
      userId: existing.request.userId,
      userName: existing.receipt.userName,
      deviceId: existing.request.deviceId,
      grantId: existing.request.grantId,
      cashRegisterId: existing.request.cashRegisterId,
      now: new Date(existing.request.occurredAt),
    });
    if (JSON.stringify(request) === JSON.stringify(existing.request)) return existing;
    throw new SaleDraftError("Já existe outra venda com esta chave neste aparelho.");
  }

  const [grant, sync, cashRegister, user] = await Promise.all([
    readMeta(db, "grant"),
    readMeta(db, "sync"),
    readMeta(db, "cashRegister"),
    readMeta(db, "user"),
  ]);
  const block = offlineBlock({ grant: grant ?? null, sync, cashRegister: cashRegister ?? null });
  if (block || !grant || !user) {
    throw new SaleDraftError(
      "A preparação deste aparelho não vale mais (autorização vencida, dados antigos ou caixa trocado). A venda não foi registrada.",
    );
  }

  const now = new Date();
  const op = newLocalOperation(
    buildSaleOperation(draft, {
      userId,
      userName: user.name,
      deviceId: grant.deviceId,
      grantId: grant.id,
      cashRegisterId: grant.cashRegisterId,
      now,
    }),
    now.getTime(),
  );
  // add (e não put): a mesma chave nunca sobrescreve uma venda já gravada
  await db.operations.add(op);
  await refreshPendingCount(userId).catch((error) =>
    console.error("Não foi possível atualizar a contagem de pendências:", error),
  );
  return op;
}

export type SendStatus =
  // Lote enviado (ou nada a enviar)
  | "done"
  // Outra aba deste navegador está enviando a fila do operador
  | "busy"
  | "unauthenticated"
  | "forbidden"
  // App desatualizado para o protocolo do servidor
  | "outdated"
  // Sem rede, tempo esgotado, servidor ou banco indisponível
  | "unreachable";

export interface SendSummary {
  status: SendStatus;
  // Vendas aplicadas (ou aprovadas) nesta rodada: a cópia local precisa sincronizar
  applied: number;
}

type ServerResult = {
  operationId: string | null;
  status:
    | "applied"
    | "approved"
    | "conflict"
    | "discarded"
    | "invalid"
    | "protocol_error"
    | "forbidden"
    | "retry";
  replayed?: boolean;
  message?: string;
  reason?: string;
  sale?: { id: string; code: number; occurredAt: string };
  appliedTxid?: string;
};

/** Trava entre abas (Web Locks): só uma aba envia a fila do operador por vez. */
async function withSendLock(userId: string, run: () => Promise<SendSummary>): Promise<SendSummary> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  // Navegador sem Web Locks (fora da matriz suportada): envio sem trava. Continua seguro, porque
  // o reenvio da mesma chave devolve o resultado já gravado.
  if (!locks) return run();
  const result = await locks.request(
    `gestao-lojas-offline-send-${userId}`,
    { ifAvailable: true },
    async (lock) => (lock ? run() : null),
  );
  return result ?? { status: "busy", applied: 0 };
}

/** Resultado do servidor → mudanças na operação local. */
function applyResult(
  op: LocalOperation,
  result: ServerResult,
  now: number,
): Partial<LocalOperation> {
  const base = { attempts: op.attempts + 1, lastAttemptAt: now };
  switch (result.status) {
    case "applied":
    case "approved":
      return {
        ...base,
        status: "synced",
        sale: result.sale ?? null,
        appliedTxid: result.appliedTxid ?? null,
        approved: result.status === "approved",
        message: null,
        conflictReason: null,
        settledAt: op.settledAt ?? now,
      };
    case "conflict":
      return {
        ...base,
        status: "conflict",
        conflictReason: result.reason ?? null,
        message: result.message ?? "Venda em conferência pelo gerente.",
      };
    case "discarded":
      return {
        ...base,
        status: "discarded",
        message: result.message ?? "Venda descartada pelo gerente.",
        settledAt: op.settledAt ?? now,
      };
    case "invalid":
    case "protocol_error":
      // Recusa sem gravação no servidor: fica visível e não é reenviada sozinha
      return {
        ...base,
        status: "rejected",
        message: result.message ?? "O servidor recusou a venda.",
      };
    case "forbidden":
      // Operação de outro operador para a sessão atual (ex.: troca de usuário durante o envio):
      // nada foi gravado; volta a ser enviada quando o operador da venda entrar
      return {
        ...base,
        status: "failed",
        message: "Venda de outro operador: é enviada quando o operador da venda entrar.",
      };
    default:
      return {
        ...base,
        status: "failed",
        message: result.message ?? "Falha temporária no servidor. Nova tentativa em seguida.",
      };
  }
}

/** Falha do lote inteiro: nada foi aplicado. Conflito continua conflito. */
async function markTransientFailure(userId: string, ops: LocalOperation[], message: string) {
  const db = userDb(userId);
  const now = Date.now();
  await db.transaction("rw", db.operations, async () => {
    for (const op of ops) {
      await db.operations.update(
        op.id,
        op.status === "conflict"
          ? { lastAttemptAt: now }
          : { status: "failed", attempts: op.attempts + 1, lastAttemptAt: now, message },
      );
    }
  });
}

async function postBatch(ops: LocalOperation[]): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(OPERATIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ protocolVersion: 1, operations: ops.map((op) => op.request) }),
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function sendBatches(userId: string, includeConflicts: boolean): Promise<SendSummary> {
  const db = userDb(userId);
  const sent = new Set<string>();
  let applied = 0;

  for (;;) {
    const now = Date.now();
    const batch = (await db.operations.where("status").anyOf(SENDABLE).toArray())
      .filter(
        (op) =>
          op.request &&
          !sent.has(op.id) &&
          (op.status !== "conflict" ||
            includeConflicts ||
            !op.lastAttemptAt ||
            now - op.lastAttemptAt >= CONFLICT_POLL_MS),
      )
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, MAX_BATCH);
    if (batch.length === 0) return { status: "done", applied };
    for (const op of batch) sent.add(op.id);

    // Com a trava, ninguém mais envia: uma "sincronizando" de uma aba fechada no meio do envio
    // volta a ser enviada aqui
    const firstSend = batch.filter((op) => op.status !== "conflict").map((op) => op.id);
    await db.operations.where("id").anyOf(firstSend).modify({ status: "syncing" });

    let res: Response;
    try {
      res = await postBatch(batch);
    } catch {
      await markTransientFailure(
        userId,
        batch,
        "Sem conexão com o servidor. A venda segue guardada.",
      );
      return { status: "unreachable", applied };
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
      const failure: [SendStatus, string] =
        res.status === 401
          ? ["unauthenticated", "Sessão expirada: entre no sistema de novo para enviar a venda."]
          : res.status === 403
            ? ["forbidden", "Sem permissão para enviar vendas do PDV."]
            : res.status === 400 && body?.code === "protocol"
              ? ["outdated", "Versão do app desatualizada: atualize o app para enviar a venda."]
              : ["unreachable", body?.error ?? "Servidor indisponível. A venda segue guardada."];
      await markTransientFailure(userId, batch, failure[1]);
      return { status: failure[0], applied };
    }

    const body = (await res.json().catch(() => null)) as { results?: ServerResult[] } | null;
    const results = new Map<string, ServerResult>();
    for (const result of body?.results ?? []) {
      if (result.operationId) results.set(result.operationId, result);
    }
    const doneAt = Date.now();
    await db.transaction("rw", db.operations, async () => {
      for (const op of batch) {
        const result = results.get(op.id) ?? {
          operationId: op.id,
          status: "retry" as const,
          message: "O servidor não respondeu sobre esta venda. Nova tentativa em seguida.",
        };
        // Conflito que segue em conflito: só registra a consulta
        if (op.status === "conflict" && result.status === "conflict") {
          await db.operations.update(op.id, { lastAttemptAt: doneAt });
          continue;
        }
        if (result.status === "applied" || result.status === "approved") applied += 1;
        await db.operations.update(op.id, applyResult(op, result, doneAt));
      }
    });
  }
}

/** Remove as vendas finalizadas que a cópia já reflete e passaram da retenção de 24 h. */
export async function pruneQueue(userId: string) {
  const db = userDb(userId);
  const sync = await readMeta(db, "sync");
  const settled = await db.operations.where("status").anyOf(["synced", "discarded"]).toArray();
  const ids = prunableOperationIds(settled, sync?.watermark, Date.now());
  if (ids.length > 0) await db.operations.bulkDelete(ids);
}

/**
 * Envia a fila do operador da sessão em lotes de até 50, na ordem em que as vendas aconteceram,
 * até esvaziar ou falhar. Conflitos são consultados de novo a cada 5 minutos (ou sempre, com
 * `includeConflicts`, no botão manual), para saber da decisão do gerente.
 */
export async function sendQueue(
  userId: string,
  { includeConflicts = false } = {},
): Promise<SendSummary> {
  const summary = await withSendLock(userId, () => sendBatches(userId, includeConflicts));
  await pruneQueue(userId).catch((error) => console.error("Falha ao limpar a fila:", error));
  await refreshPendingCount(userId).catch((error) =>
    console.error("Não foi possível atualizar a contagem de pendências:", error),
  );
  return summary;
}
