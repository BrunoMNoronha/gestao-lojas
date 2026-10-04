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

/** Operação local pendente (fila da #38). Nesta etapa a fila existe, mas fica vazia. */
export interface LocalOperation {
  id: string;
  status: string;
  createdAt: number;
}

export class OfflineUserDb extends Dexie {
  products!: EntityTable<LocalProduct, "id">;
  categories!: EntityTable<LocalCategory, "id">;
  customers!: EntityTable<LocalCustomer, "id">;
  meta!: EntityTable<MetaRow, "key">;
  operations!: EntityTable<LocalOperation, "id">;

  constructor(userId: string) {
    super(userDbName(userId));
    // Atualizações futuras da estrutura entram como version(2), version(3)... com upgrade: a
    // fila de operações nunca é descartada numa atualização do app.
    this.version(1).stores({
      products: "id, barcode, sku, categoryId",
      categories: "id",
      customers: "id",
      meta: "key",
      operations: "id, status, createdAt",
    });
  }
}

interface CommonRow {
  key: "deviceId" | "deviceName" | "activeUserId";
  value: string | null;
}

interface PendingCount {
  userId: string;
  count: number;
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

const EMPTY_SYNC: SyncState = { cursor: null, complete: false, syncedAt: null, generatedAt: null };

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
 * Encerra a operação offline do operador (saída, troca de usuário ou perda de acesso): apaga a
 * cópia de dados e a autorização. Se houver operações pendentes, o banco fica só com a fila, que
 * continua oculta para os outros operadores até o dono sincronizar; nada pendente é apagado.
 */
export async function endOfflineSession(userId: string) {
  const db = userDb(userId);
  const pending = await db.operations.count();
  if (pending > 0) {
    await db.transaction("rw", [db.products, db.categories, db.customers, db.meta], () =>
      Promise.all([
        db.products.clear(),
        db.categories.clear(),
        db.customers.clear(),
        db.meta.clear(),
      ]),
    );
    await commonDb().pending.put({ userId, count: pending });
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
