import Dexie, { type EntityTable } from "dexie";
import type { SessionUser } from "@/lib/authz";
import type { OfflinePreparation } from "@/lib/offline-device";
import type {
  OfflineCategory,
  OfflineCustomer,
  OfflineProduct,
  OfflineSnapshot,
  OfflineStore,
} from "@/lib/offline-snapshot";

// Banco local do PDV offline no navegador (issue #37, docs/OFFLINE.md seções 6.3 e 7). Só roda no
// cliente. Cada operador tem o próprio banco (`gestao-lojas-offline-<userId>`); o banco comum
// guarda apenas o aparelho, o operador ativo e a contagem de pendências por operador. Senha e
// sessão nunca são gravadas aqui: a sessão continua no cookie HttpOnly do Auth.js, e nada daqui
// vale como autorização no servidor.

export type LocalProduct = Extract<OfflineProduct, { deleted: false }>;
export type LocalCategory = Extract<OfflineCategory, { deleted: false }>;
export type LocalCustomer = Extract<OfflineCustomer, { deleted: false }>;

/** Autorização offline emitida na preparação (instantes do servidor). */
export type LocalGrant = OfflinePreparation["grant"] & { deviceId: string };

export interface SyncState {
  // Cursor opaco da última página aplicada (null antes da primeira carga)
  cursor: string | null;
  // Carga completa terminou (todas as páginas): sem isso o PDV offline não abre
  complete: boolean;
  // Relógio do aparelho ao terminar a última sincronização completa (idade dos dados)
  syncedAt: number | null;
  // Instante do servidor da última resposta aplicada
  generatedAt: string | null;
  // Limite seguro da última sequência de páginas concluída (texto: bigint). Venda sincronizada
  // com appliedTxid menor já tem a baixa de estoque refletida na cópia (#38)
  watermark?: string | null;
}

export interface LocalMeta {
  sync: SyncState;
  grant: LocalGrant | null;
  user: SessionUser;
  store: OfflineStore | null;
  cashRegister: OfflineSnapshot["cashRegister"];
  // navigator.storage.persist() concedido (sem isso o navegador pode apagar os dados)
  persisted: boolean;
}

type MetaRow = { [K in keyof LocalMeta]: { key: K; value: LocalMeta[K] } }[keyof LocalMeta];

/**
 * Situação de uma operação na fila (docs/OFFLINE.md seção 4):
 * - pending: gravada, ainda não enviada;
 * - syncing: enviada, aguardando resposta;
 * - failed: falha recuperável (rede, servidor, sessão); nada foi aplicado, nova tentativa;
 * - synced: aplicada no servidor (inclusive conflito aprovado), com o código oficial;
 * - conflict: recusada por regra de negócio, guardada no servidor para um gerente decidir;
 * - discarded: conflito descartado por um gerente (final);
 * - rejected: recusada sem ser gravada no servidor (formato, chave reaproveitada ou autoria).
 *   Não é reenviada sozinha e nunca é apagada em silêncio.
 */
export type LocalOperationStatus =
  "pending" | "syncing" | "failed" | "synced" | "conflict" | "discarded" | "rejected";

/** Envelope do protocolo v1 de POST /api/offline/operations (decimais sempre como texto). */
export interface OfflineSaleRequest {
  protocolVersion: 1;
  operationId: string;
  kind: "sale.create";
  deviceId: string;
  grantId: string;
  userId: string;
  cashRegisterId: string;
  occurredAt: string;
  payload: {
    customerId: string | null;
    paymentMethod: "MONEY" | "PIX" | "CREDIT_CARD" | "DEBIT_CARD";
    discount: string;
    amountPaid?: string;
    items: { productId: string; quantity: string; unitPrice: string }[];
  };
}

/** Dados do recibo provisório (nomes e valores como o operador viu no momento da venda). */
export interface LocalReceipt {
  userName: string;
  customerName: string;
  customerDocument: string | null;
  total: string;
  discount: string;
  amountPaid: string;
  change: string;
  items: {
    productId: string;
    productName: string;
    unit: string;
    quantity: string;
    unitPrice: string;
    subtotal: string;
  }[];
}

/** Operação da fila (#38): uma venda feita no /pdv, com ou sem conexão. */
export interface LocalOperation {
  id: string; // operationId
  status: LocalOperationStatus;
  createdAt: number; // relógio do aparelho
  // Ordem de gravação no banco do operador (1, 2, 3...): desempata vendas do mesmo milissegundo.
  // Ausente nas gravadas antes deste campo; não indexado, então não exige versão nova do banco
  seq?: number;
  request: OfflineSaleRequest;
  receipt: LocalReceipt;
  attempts: number;
  lastAttemptAt: number | null;
  // Mensagem da última falha, do conflito ou da recusa
  message: string | null;
  conflictReason: string | null;
  // Venda oficial e transação que a gravou (depois de sincronizada)
  sale: { id: string; code: number; occurredAt: string } | null;
  appliedTxid: string | null;
  approved: boolean;
  // Quando chegou a um estado final (synced ou discarded)
  settledAt: number | null;
}

/** Ainda não gravada no servidor (bloqueia o fechamento do caixa). */
export const UNSENT_STATUSES: LocalOperationStatus[] = ["pending", "syncing", "failed", "rejected"];
/** Estados finais: a operação pode sair da fila depois do prazo de retenção. */
export const FINAL_STATUSES: LocalOperationStatus[] = ["synced", "discarded"];

/**
 * Atualização da versão 1 para a 2. Na versão 1 a fila existia, mas nenhuma venda era gravada
 * nela; uma linha sem os dados da venda fica como recusada (visível), nunca é apagada.
 */
export function upgradeOperationV1(op: Partial<LocalOperation> & { id: string }): LocalOperation {
  const hasSale = !!op.request && !!op.receipt;
  return {
    ...op,
    id: op.id,
    status: hasSale ? (op.status ?? "pending") : "rejected",
    createdAt: op.createdAt ?? Date.now(),
    request: op.request as OfflineSaleRequest,
    receipt: op.receipt as LocalReceipt,
    attempts: op.attempts ?? 0,
    lastAttemptAt: op.lastAttemptAt ?? null,
    message: hasSale
      ? (op.message ?? null)
      : "Operação de uma versão antiga do app, sem os dados da venda.",
    conflictReason: op.conflictReason ?? null,
    sale: op.sale ?? null,
    appliedTxid: op.appliedTxid ?? null,
    approved: op.approved ?? false,
    settledAt: op.settledAt ?? null,
  };
}

export class OfflineUserDb extends Dexie {
  products!: EntityTable<LocalProduct, "id">;
  categories!: EntityTable<LocalCategory, "id">;
  customers!: EntityTable<LocalCustomer, "id">;
  meta!: EntityTable<MetaRow, "key">;
  operations!: EntityTable<LocalOperation, "id">;

  constructor(userId: string) {
    super(userDbName(userId));
    // Cada mudança de estrutura entra como uma versão nova com upgrade: a fila de operações
    // nunca é descartada numa atualização do app.
    this.version(1).stores({
      products: "id, barcode, sku, categoryId",
      categories: "id",
      customers: "id",
      meta: "key",
      operations: "id, status, createdAt",
    });
    // #38: a fila guarda a venda completa; settledAt indexa a limpeza das já finalizadas
    this.version(2)
      .stores({ operations: "id, status, createdAt, settledAt" })
      .upgrade((tx) =>
        tx
          .table("operations")
          .toCollection()
          .modify((op: LocalOperation) => {
            Object.assign(op, upgradeOperationV1(op));
          }),
      );
  }
}

interface CommonRow {
  key: "deviceId" | "deviceName" | "activeUserId";
  value: string | null;
}

interface PendingCount {
  userId: string;
  // Operações ainda não finalizadas (não enviadas ou em conflito)
  count: number;
  // Vendas ainda não gravadas no servidor, por caixa (bloqueiam o fechamento dele)
  unsentByCashRegister?: Record<string, number>;
}

class OfflineCommonDb extends Dexie {
  state!: EntityTable<CommonRow, "key">;
  pending!: EntityTable<PendingCount, "userId">;

  constructor() {
    super(COMMON_DB_NAME);
    this.version(1).stores({ state: "key", pending: "userId" });
  }
}

const COMMON_DB_NAME = "gestao-lojas-offline";
const userDbName = (userId: string) => `${COMMON_DB_NAME}-${userId}`;

let common: OfflineCommonDb | null = null;
const userDbs = new Map<string, OfflineUserDb>();

function commonDb() {
  common ??= new OfflineCommonDb();
  return common;
}

export function userDb(userId: string): OfflineUserDb {
  let db = userDbs.get(userId);
  if (!db) {
    db = new OfflineUserDb(userId);
    userDbs.set(userId, db);
  }
  return db;
}

async function readCommon(key: CommonRow["key"]): Promise<string | null> {
  return (await commonDb().state.get(key))?.value ?? null;
}

export async function getDevice(): Promise<{ id: string | null; name: string | null }> {
  const [id, name] = await Promise.all([readCommon("deviceId"), readCommon("deviceName")]);
  return { id, name };
}

export const getActiveUserId = () => readCommon("activeUserId");

export async function readMeta<K extends keyof LocalMeta>(
  db: OfflineUserDb,
  key: K,
): Promise<LocalMeta[K] | undefined> {
  const row = await db.meta.get(key);
  return row?.value as LocalMeta[K] | undefined;
}

/** Grava o resultado da preparação: aparelho, operador ativo e autorização offline. */
export async function savePreparation(prep: OfflinePreparation, persisted: boolean) {
  const db = userDb(prep.user.id);
  await db.meta.bulkPut([
    { key: "grant", value: { ...prep.grant, deviceId: prep.device.id } },
    { key: "user", value: prep.user },
    { key: "persisted", value: persisted },
  ]);
  await commonDb().state.bulkPut([
    { key: "deviceId", value: prep.device.id },
    { key: "deviceName", value: prep.device.name },
    { key: "activeUserId", value: prep.user.id },
  ]);
}

const EMPTY_SYNC: SyncState = {
  cursor: null,
  complete: false,
  syncedAt: null,
  generatedAt: null,
  watermark: null,
};

/**
 * Aplica uma página da cópia do servidor numa única transação. `reset` (carga completa) apaga a
 * cópia antes; exclusões removem o registro. A fila de operações nunca é tocada.
 */
export async function applySnapshotPage(db: OfflineUserDb, page: OfflineSnapshot) {
  await db.transaction("rw", [db.products, db.categories, db.customers, db.meta], async () => {
    if (page.reset) {
      await Promise.all([db.products.clear(), db.categories.clear(), db.customers.clear()]);
    }
    const split = <T extends { id: string; deleted: boolean }>(rows: T[]) => ({
      put: rows.filter((row): row is Extract<T, { deleted: false }> => !row.deleted),
      del: rows.filter((row) => row.deleted).map((row) => row.id),
    });
    const products = split(page.products);
    const categories = split(page.categories);
    const customers = split(page.customers);
    await Promise.all([
      db.products.bulkPut(products.put),
      db.products.bulkDelete(products.del),
      db.categories.bulkPut(categories.put),
      db.categories.bulkDelete(categories.del),
      db.customers.bulkPut(customers.put),
      db.customers.bulkDelete(customers.del),
    ]);

    const previous = page.reset ? EMPTY_SYNC : ((await readMeta(db, "sync")) ?? EMPTY_SYNC);
    const done = !page.hasMore;
    const sync: SyncState = {
      cursor: page.cursor,
      // Toda sequência de páginas desde a carga completa até hasMore = false deixa a cópia
      // inteira, mesmo se interrompida e retomada pelo cursor
      complete: previous.complete || done,
      syncedAt: done ? Date.now() : previous.syncedAt,
      generatedAt: page.generatedAt,
      // O limite só vale ao fim da sequência: aí tudo abaixo dele já chegou à cópia
      watermark: done ? page.watermark : (previous.watermark ?? null),
    };
    await db.meta.bulkPut([
      { key: "sync", value: sync },
      { key: "store", value: page.store },
      { key: "cashRegister", value: page.cashRegister },
      { key: "user", value: page.user },
    ]);
  });
}

/**
 * Atualiza, no banco comum, a contagem de operações não finalizadas do operador e as vendas
 * ainda não gravadas no servidor por caixa. É o que o painel lê para bloquear o fechamento do
 * caixa e o que fica visível de uma fila de outro operador.
 */
export async function refreshPendingCount(userId: string) {
  const db = userDb(userId);
  const open = await db.operations.where("status").noneOf(FINAL_STATUSES).toArray();
  if (open.length === 0) {
    await commonDb().pending.delete(userId);
    return;
  }
  const unsentByCashRegister: Record<string, number> = {};
  for (const op of open) {
    if (!UNSENT_STATUSES.includes(op.status) || !op.request) continue;
    const id = op.request.cashRegisterId;
    unsentByCashRegister[id] = (unsentByCashRegister[id] ?? 0) + 1;
  }
  await commonDb().pending.put({ userId, count: open.length, unsentByCashRegister });
}

/**
 * Vendas deste navegador ainda não gravadas no servidor para o caixa (de qualquer operador).
 * Não cria o banco local quando ele não existe (painel sem uso do PDV offline).
 */
export async function unsentSalesForCashRegister(cashRegisterId: string): Promise<number> {
  if (!(await Dexie.exists(COMMON_DB_NAME))) return 0;
  const rows = await commonDb().pending.toArray();
  return rows.reduce((sum, row) => sum + (row.unsentByCashRegister?.[cashRegisterId] ?? 0), 0);
}

export interface OperatorQueue {
  userId: string;
  userName: string;
  // Ainda não gravadas no servidor / já no servidor, aguardando decisão
  unsent: number;
  conflicts: number;
}

/**
 * Filas de outros operadores guardadas neste navegador (docs/OFFLINE.md seção 3.5): quem saiu
 * ou perdeu o acesso com vendas não enviadas. Só o envio assistido por um gerente lê isto.
 */
export async function otherOperatorQueues(currentUserId: string): Promise<OperatorQueue[]> {
  if (!(await Dexie.exists(COMMON_DB_NAME))) return [];
  const rows = await commonDb().pending.where("userId").notEqual(currentUserId).toArray();
  const queues = await Promise.all(
    rows.map(async (row) => {
      const ops = await userDb(row.userId)
        .operations.where("status")
        .noneOf(FINAL_STATUSES)
        .toArray();
      return {
        userId: row.userId,
        userName: ops.find((op) => op.receipt)?.receipt.userName ?? "Operador",
        unsent: ops.filter((op) => UNSENT_STATUSES.includes(op.status)).length,
        conflicts: ops.filter((op) => op.status === "conflict").length,
      };
    }),
  );
  return queues.filter((q) => q.unsent + q.conflicts > 0);
}

/**
 * Encerra a operação offline do operador (saída, troca de usuário ou perda de acesso): apaga a
 * cópia de dados e a autorização. Se houver operações não finalizadas, o banco fica só com a
 * fila, que continua oculta para os outros operadores até o dono sincronizar; nada pendente é
 * apagado.
 */
export async function endOfflineSession(userId: string) {
  const db = userDb(userId);
  const open = await db.operations.where("status").noneOf(FINAL_STATUSES).count();
  if (open > 0) {
    await db.transaction("rw", [db.products, db.categories, db.customers, db.meta], () =>
      Promise.all([
        db.products.clear(),
        db.categories.clear(),
        db.customers.clear(),
        db.meta.clear(),
      ]),
    );
    await refreshPendingCount(userId);
  } else {
    db.close();
    userDbs.delete(userId);
    await Dexie.delete(userDbName(userId));
    await commonDb().pending.delete(userId);
  }
  if ((await getActiveUserId()) === userId) {
    await commonDb().state.put({ key: "activeUserId", value: null });
  }
}

/** Saída do sistema: encerra a operação offline do operador ativo, se houver. */
export async function endActiveOfflineSession() {
  if (!(await Dexie.exists(COMMON_DB_NAME))) return;
  const active = await getActiveUserId();
  if (active) await endOfflineSession(active);
}

/** Outro usuário entrou no aparelho: os dados do operador anterior não ficam expostos. */
export async function endOfflineSessionIfOtherUser(currentUserId: string) {
  if (!(await Dexie.exists(COMMON_DB_NAME))) return;
  const active = await getActiveUserId();
  if (active && active !== currentUserId) await endOfflineSession(active);
}
