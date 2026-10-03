import { Prisma, type Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/authz";
import { maskDocument } from "@/lib/masks";

// Cópia local dos dados do PDV (issue #36, docs/OFFLINE.md seções 3.8 e 5). Usado apenas no
// servidor, pelo Route Handler GET /api/offline/snapshot, que autoriza com "pdv.use" antes.
//
// Sincronização incremental sem perdas: cada linha de Product, Category e Customer tem
// `syncVersion`, preenchida por gatilho no banco com o id da transação que a gravou (migration
// 0007). A leitura só entrega versões abaixo de `pg_snapshot_xmin(pg_current_snapshot())`: todas as
// transações com id menor já terminaram, então nenhuma gravação ainda em andamento (venda com
// baixa de estoque por updateMany, edição de produto...) pode confirmar depois com versão já
// ultrapassada pelo cursor. O que estiver acima desse limite chega na próxima leitura.

export const OFFLINE_PROTOCOL_VERSION = 1;
export const SNAPSHOT_DEFAULT_LIMIT = 500;
export const SNAPSHOT_MAX_LIMIT = 1000;

/** Cursor ou limite inválido enviado pelo aparelho (o Route Handler responde 400). */
export class SnapshotRequestError extends Error {}

const ENTITIES = ["products", "categories", "customers"] as const;
type Entity = (typeof ENTITIES)[number];

/** Última linha entregue de uma tabela: versão de sincronização e id (desempate). */
interface Position {
  version: bigint;
  id: string;
}

type Cursor = Record<Entity, Position>;

const START: Position = { version: BigInt(0), id: "" };

// Exclusões chegam só com o id: o aparelho remove o registro da cópia local
export type Tombstone = { id: string; deleted: true };

export type OfflineProduct =
  | {
      id: string;
      deleted: false;
      name: string;
      sku: string | null;
      barcode: string | null;
      // Decimais como texto para não perder precisão no JSON
      salePrice: string;
      unit: Unit;
      currentStock: string;
      categoryId: string | null;
      updatedAt: string;
    }
  | Tombstone;

export type OfflineCategory = { id: string; deleted: false; name: string } | Tombstone;

export type OfflineCustomer =
  { id: string; deleted: false; name: string; document: string | null } | Tombstone;

/** Dados da loja impressos no recibo (sem parâmetros do Fiado nem demais configurações). */
export interface OfflineStore {
  personType: string;
  companyName: string;
  tradeName: string;
  document: string | null;
  phone: string | null;
  zipCode: string | null;
  address: string | null;
  number: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  receiptFooterNote: string | null;
}

export interface OfflineSnapshot {
  protocolVersion: number;
  generatedAt: string;
  // Sem cursor na requisição: carga completa, o aparelho substitui a cópia local inteira
  reset: boolean;
  // Enviar na próxima requisição; com hasMore, pedir a próxima página imediatamente
  cursor: string;
  hasMore: boolean;
  products: OfflineProduct[];
  categories: OfflineCategory[];
  customers: OfflineCustomer[];
  // Enviados completos em toda resposta (poucos dados, sem cursor)
  store: OfflineStore | null;
  cashRegister: { id: string; openedAt: string; openingAmount: string } | null;
  user: SessionUser;
}

// Cursor opaco para o aparelho: base64url de {"p":[versão,id],"c":[...],"k":[...]}
const CURSOR_KEYS: Record<Entity, string> = { products: "p", categories: "c", customers: "k" };
const MAX_CURSOR_LENGTH = 1024;

export function encodeCursor(cursor: Cursor): string {
  const json: Record<string, [string, string]> = {};
  for (const entity of ENTITIES) {
    json[CURSOR_KEYS[entity]] = [cursor[entity].version.toString(), cursor[entity].id];
  }
  return Buffer.from(JSON.stringify(json)).toString("base64url");
}

export function decodeCursor(value: string): Cursor {
  const invalid = new SnapshotRequestError("Cursor de sincronização inválido.");
  if (value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalid;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalid;
  }
  if (!json || typeof json !== "object") throw invalid;

  const cursor = {} as Cursor;
  for (const entity of ENTITIES) {
    const pair = (json as Record<string, unknown>)[CURSOR_KEYS[entity]];
    if (!Array.isArray(pair) || pair.length !== 2) throw invalid;
    const [version, id] = pair;
    if (typeof version !== "string" || !/^\d{1,19}$/.test(version)) throw invalid;
    if (typeof id !== "string" || id.length > 64) throw invalid;
    cursor[entity] = { version: BigInt(version), id };
  }
  return cursor;
}

export function parseLimit(value: string | null): number {
  if (value === null || value === "") return SNAPSHOT_DEFAULT_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > SNAPSHOT_MAX_LIMIT) {
    throw new SnapshotRequestError(`O limite deve ser um inteiro entre 1 e ${SNAPSHOT_MAX_LIMIT}.`);
  }
  return limit;
}

/** Linhas depois da posição e abaixo do limite seguro, na ordem do cursor. */
function pageWhere(after: Position, watermark: bigint) {
  return {
    syncVersion: { lt: watermark },
    OR: [
      { syncVersion: { gt: after.version } },
      { syncVersion: after.version, id: { gt: after.id } },
    ],
  };
}

const PAGE_ORDER = [{ syncVersion: "asc" as const }, { id: "asc" as const }];

/**
 * Próxima posição do cursor: a última linha entregue, se há mais páginas; senão o limite seguro
 * (tudo abaixo dele já foi entregue e nenhuma transação nova recebe id menor).
 */
function nextPosition(
  after: Position,
  rows: { id: string; syncVersion: bigint }[],
  hasMore: boolean,
  watermark: bigint,
): Position {
  if (hasMore) {
    const last = rows[rows.length - 1];
    return { version: last.syncVersion, id: last.id };
  }
  return after.version >= watermark ? after : { version: watermark, id: "" };
}

/**
 * Lê uma página da cópia local para o operador já autorizado. Sem cursor, começa do zero (carga
 * completa); com cursor, devolve só o que mudou, inclusive exclusões (exclusão lógica).
 */
export async function readOfflineSnapshot(
  user: SessionUser,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<OfflineSnapshot> {
  const reset = !options.cursor;
  const after: Cursor = options.cursor
    ? decodeCursor(options.cursor)
    : { products: START, categories: START, customers: START };
  const limit = options.limit ?? SNAPSHOT_DEFAULT_LIMIT;

  // REPEATABLE READ: o limite seguro e as consultas usam o mesmo retrato do banco
  return prisma.$transaction(
    async (tx) => {
      const [{ watermark }] = await tx.$queryRaw<{ watermark: bigint }[]>`
        SELECT pg_snapshot_xmin(pg_current_snapshot())::text::bigint AS watermark
      `;

      const [products, categories, customers, settings, cashRegister] = await Promise.all([
        tx.product.findMany({
          where: pageWhere(after.products, watermark),
          orderBy: PAGE_ORDER,
          take: limit + 1,
          select: {
            id: true,
            syncVersion: true,
            deletedAt: true,
            name: true,
            sku: true,
            barcode: true,
            salePrice: true,
            unit: true,
            currentStock: true,
            categoryId: true,
            updatedAt: true,
          },
        }),
        tx.category.findMany({
          where: pageWhere(after.categories, watermark),
          orderBy: PAGE_ORDER,
          take: limit + 1,
          select: { id: true, syncVersion: true, deletedAt: true, name: true },
        }),
        tx.customer.findMany({
          where: pageWhere(after.customers, watermark),
          orderBy: PAGE_ORDER,
          take: limit + 1,
          select: { id: true, syncVersion: true, deletedAt: true, name: true, document: true },
        }),
        tx.storeSettings.findUnique({
          where: { id: "default" },
          select: {
            personType: true,
            companyName: true,
            tradeName: true,
            document: true,
            phone: true,
            zipCode: true,
            address: true,
            number: true,
            neighborhood: true,
            city: true,
            state: true,
            receiptFooterNote: true,
          },
        }),
        // Só o caixa aberto do próprio operador (nada de movimentos ou de outros caixas)
        tx.cashRegister.findUnique({
          where: { openUserId: user.id },
          select: { id: true, openedAt: true, openingAmount: true },
        }),
      ]);

      const page = <T>(rows: T[]) => ({ rows: rows.slice(0, limit), hasMore: rows.length > limit });
      const p = page(products);
      const c = page(categories);
      const k = page(customers);

      const next: Cursor = {
        products: nextPosition(after.products, p.rows, p.hasMore, watermark),
        categories: nextPosition(after.categories, c.rows, c.hasMore, watermark),
        customers: nextPosition(after.customers, k.rows, k.hasMore, watermark),
      };

      return {
        protocolVersion: OFFLINE_PROTOCOL_VERSION,
        generatedAt: new Date().toISOString(),
        reset,
        cursor: encodeCursor(next),
        hasMore: p.hasMore || c.hasMore || k.hasMore,
        products: p.rows.map((row): OfflineProduct =>
          row.deletedAt
            ? { id: row.id, deleted: true }
            : {
                id: row.id,
                deleted: false,
                name: row.name,
                sku: row.sku,
                barcode: row.barcode,
                salePrice: row.salePrice.toFixed(2),
                unit: row.unit,
                currentStock: row.currentStock.toFixed(3),
                categoryId: row.categoryId,
                updatedAt: row.updatedAt.toISOString(),
              },
        ),
        categories: c.rows.map((row): OfflineCategory =>
          row.deletedAt
            ? { id: row.id, deleted: true }
            : { id: row.id, deleted: false, name: row.name },
        ),
        customers: k.rows.map((row): OfflineCustomer =>
          row.deletedAt
            ? { id: row.id, deleted: true }
            : { id: row.id, deleted: false, name: row.name, document: maskDocument(row.document) },
        ),
        store: settings,
        cashRegister: cashRegister && {
          id: cashRegister.id,
          openedAt: cashRegister.openedAt.toISOString(),
          openingAmount: cashRegister.openingAmount.toFixed(2),
        },
        user: { id: user.id, name: user.name, role: user.role },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
