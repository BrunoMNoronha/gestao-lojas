import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  MovementType,
  Prisma,
  TestDataRunKind,
  TestDataRunStatus,
  type PrismaClient,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/authz";
import { documentLookupValues } from "@/lib/masks";
import { parseOperationId } from "@/lib/sync-operation";
import {
  buildTestData,
  randomCnpj,
  randomCpf,
  randomEan13,
  randomSku,
  uniqueName,
  validateTestDataCounts,
  type Random,
  type TestDataCounts,
  type TestDataSet,
} from "@/lib/test-data-generator";

// Seção "Dados de teste" em Configurações (issue #57): gera dados sintéticos e restaura o banco.
// Módulo comum (sem "use server"), chamado pelas Server Actions de src/actions/test-data.ts, que
// autorizam com "settings.manage" antes.
//
// - Geração e restauração rodam em transação, sob a mesma trava consultiva: nunca correm juntas.
// - Cada execução vira uma linha de TestDataRun. A concluída usa o id do pedido do navegador
//   (idempotência: o mesmo pedido devolve o resultado gravado); recusas e falhas ganham id próprio
//   e guardam o id do pedido em `params`, para que o mesmo pedido possa ser tentado de novo.
// - A restauração apaga, com TRUNCATE de lista fechada e sem CASCADE, todas as tabelas exceto as
//   de KEPT_TABLES. Se surgir tabela nova que dependa das apagadas, o Postgres recusa o comando
//   em vez de apagar além da lista (e o teste de integração obriga a classificá-la).

/** Tabelas apagadas pela restauração, na ordem do TRUNCATE. */
export const RESET_TABLES = [
  "ReconciliationIssue",
  "SyncOperation",
  "OfflineGrant",
  "OfflineDevice",
  "ReceivablePayment",
  "Receivable",
  "SaleItem",
  "Sale",
  "CashMovement",
  "CashRegister",
  "StockMovement",
  "ProductPrice",
  "Product",
  "Category",
  "Customer",
  "Supplier",
] as const;

/** Tabelas que a restauração mantém. */
export const KEPT_TABLES = ["User", "StoreSettings", "TestDataRun", "_prisma_migrations"] as const;

export type ResetTable = (typeof RESET_TABLES)[number];
export type ResetCounts = Record<ResetTable, number>;

export interface GeneratedCounts {
  categories: number;
  products: number;
  customers: number;
  suppliers: number;
  stockMovements: number;
}

// Trava consultiva compartilhada pela geração e pela restauração (número fixo da issue #57)
const LOCK_SQL = "SELECT pg_advisory_xact_lock(57057)";
// Espera máxima por travas de tabela na restauração: falha em vez de ficar parada
const RESET_LOCK_TIMEOUT_SQL = "SET LOCAL lock_timeout = '10s'";
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

const MAX_COLLISION_ROUNDS = 5;
const STOCK_REASON = "Estoque inicial (dados de teste)";

/** Tentativas de confirmação erradas por usuário antes do bloqueio temporário. */
export const MAX_RESET_CONFIRMATION_FAILURES = 5;
export const RESET_CONFIRMATION_WINDOW_MS = 15 * 60 * 1000;
const CONFIRMATION_REASON = "confirmation";

const GENERIC_ERROR = "Não foi possível concluir agora. Tente novamente em instantes.";
const INVALID_REQUEST = "Pedido inválido. Recarregue a página e tente novamente.";
const CONFIRMATION_ERROR = "Nome da loja ou senha incorretos.";

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;

/** Recusa esperada dentro da transação: desfaz tudo e vira resposta com a mensagem. */
class TestDataRejection extends Error {
  constructor(
    message: string,
    readonly blockers?: ResetBlockers,
  ) {
    super(message);
  }
}

// Histórico

/** Grava recusa ou falha com id próprio (fora da transação, que foi desfeita). */
async function recordUnsuccessfulRun(
  kind: TestDataRunKind,
  status: TestDataRunStatus,
  user: SessionUser,
  message: string,
  params: Prisma.InputJsonObject,
) {
  try {
    await prisma.testDataRun.create({
      data: { id: randomUUID(), kind, status, userId: user.id, message, params },
    });
  } catch (error) {
    console.error("Erro ao registrar execução de dados de teste:", error);
  }
}

/** Execução concluída com o mesmo id de pedido, se houver. */
async function findCompletedRun(tx: Tx, requestId: string, kind: TestDataRunKind) {
  const run = await tx.testDataRun.findUnique({ where: { id: requestId } });
  if (!run) return null;
  if (run.kind !== kind || run.status !== TestDataRunStatus.COMPLETED) {
    throw new TestDataRejection(INVALID_REQUEST);
  }
  return run;
}

/**
 * Época dos dados: quantas restaurações já foram concluídas, ou "" se nunca houve. A cópia local do
 * PDV guarda a época no cursor e recomeça do zero quando ela muda (docs/OFFLINE.md, seção 5). A
 * contagem só cresce (o histórico nunca é apagado e as restaurações correm sob a mesma trava); a
 * data de criação não serve, porque duas restaurações podem empatar ou gravar fora de ordem.
 */
export async function getDataEpoch(db: Db = prisma): Promise<string> {
  const resets = await db.testDataRun.count({
    where: { kind: TestDataRunKind.RESET, status: TestDataRunStatus.COMPLETED },
  });
  return resets === 0 ? "" : String(resets);
}

export interface TestDataRunItem {
  id: string;
  kind: TestDataRunKind;
  status: TestDataRunStatus;
  userName: string;
  createdAt: string;
  counts: Record<string, number> | null;
  message: string | null;
}

/** Últimas execuções para a tela de configurações. */
export async function getRecentTestDataRuns(limit = 10): Promise<TestDataRunItem[]> {
  const runs = await prisma.testDataRun.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      kind: true,
      status: true,
      createdAt: true,
      counts: true,
      message: true,
      user: { select: { name: true } },
    },
  });
  return runs.map((run) => ({
    id: run.id,
    kind: run.kind,
    status: run.status,
    userName: run.user.name,
    createdAt: run.createdAt.toISOString(),
    counts: (run.counts as Record<string, number> | null) ?? null,
    message: run.message,
  }));
}

// Geração

/**
 * Troca os valores que já existem no banco por outros. `findExisting` devolve, dentre os
 * candidatos, os já usados; `regenerate` cria um valor novo. Desiste depois de algumas rodadas.
 */
async function avoidExisting(
  values: string[],
  findExisting: (candidates: string[]) => Promise<Set<string>>,
  regenerate: () => string,
): Promise<string[]> {
  const result = [...values];
  const used = new Set(result);
  for (let round = 0; round < MAX_COLLISION_ROUNDS; round++) {
    if (result.length === 0) return result;
    const existing = await findExisting(result);
    if (existing.size === 0) return result;
    for (let i = 0; i < result.length; i++) {
      if (!existing.has(result[i])) continue;
      let next = regenerate();
      while (used.has(next) || existing.has(next)) next = regenerate();
      used.add(next);
      result[i] = next;
    }
  }
  throw new Error("Não foi possível evitar colisões com os dados existentes.");
}

/** Valor normalizado (só dígitos) presente no banco, inclusive gravado com pontuação antiga. */
function existingDocuments(rows: { document: string | null }[], candidates: string[]) {
  const found = new Set<string>();
  for (const candidate of candidates) {
    const forms = new Set(documentLookupValues(candidate));
    if (rows.some((row) => row.document !== null && forms.has(row.document))) found.add(candidate);
  }
  return found;
}

/** Ajusta o conjunto gerado para não colidir com o que já existe no banco. */
async function resolveCollisions(tx: Tx, data: TestDataSet, random: Random) {
  // Categoria: nome único só entre as ativas; colisão ganha sufixo numérico
  if (data.categories.length > 0) {
    const active = await tx.category.findMany({
      where: { deletedAt: null },
      select: { name: true },
    });
    const taken = new Set(active.map((c) => c.name));
    for (const category of data.categories) {
      category.name = uniqueName(category.name, taken);
      taken.add(category.name);
    }
  }

  const skus = await avoidExisting(
    data.products.map((p) => p.sku),
    async (candidates) => {
      const rows = await tx.product.findMany({
        where: { sku: { in: candidates }, deletedAt: null },
        select: { sku: true },
      });
      return new Set(rows.map((r) => r.sku!));
    },
    () => randomSku(random),
  );
  const barcodes = await avoidExisting(
    data.products.map((p) => p.barcode),
    async (candidates) => {
      const rows = await tx.product.findMany({
        where: { barcode: { in: candidates }, deletedAt: null },
        select: { barcode: true },
      });
      return new Set(rows.map((r) => r.barcode!));
    },
    () => randomEan13(random),
  );
  data.products.forEach((product, i) => {
    product.sku = skus[i];
    product.barcode = barcodes[i];
  });

  // Cliente: documento único só entre os ativos
  const cpfs = await avoidExisting(
    data.customers.map((c) => c.document),
    async (candidates) => {
      const rows = await tx.customer.findMany({
        where: { document: { in: candidates.flatMap(documentLookupValues) }, deletedAt: null },
        select: { document: true },
      });
      return existingDocuments(rows, candidates);
    },
    () => randomCpf(random),
  );
  data.customers.forEach((customer, i) => (customer.document = cpfs[i]));

  // Fornecedor: documento único no banco inteiro
  const cnpjs = await avoidExisting(
    data.suppliers.map((s) => s.document),
    async (candidates) => {
      const rows = await tx.supplier.findMany({
        where: { document: { in: candidates.flatMap(documentLookupValues) } },
        select: { document: true },
      });
      return existingDocuments(rows, candidates);
    },
    () => randomCnpj(random),
  );
  data.suppliers.forEach((supplier, i) => (supplier.document = cnpjs[i]));
}

/** Grava o conjunto e devolve as contagens. Chamado dentro da transação. */
async function insertTestData(tx: Tx, user: SessionUser, data: TestDataSet) {
  const categories = await tx.category.createManyAndReturn({
    data: data.categories.map((c) => ({ name: c.name })),
    select: { id: true, name: true },
  });
  const categoryIdByName = new Map(categories.map((c) => [c.name, c.id]));

  const suppliers = await tx.supplier.createManyAndReturn({
    data: data.suppliers,
    select: { id: true, document: true },
  });
  const supplierIdByDocument = new Map(suppliers.map((s) => [s.document!, s.id]));

  const customers = await tx.customer.createMany({ data: data.customers });

  // Os gatilhos do banco preenchem syncVersion e gravam a primeira linha de ProductPrice
  const products = await tx.product.createManyAndReturn({
    data: data.products.map((p) => ({
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      costPrice: p.costPrice,
      salePrice: p.salePrice,
      unit: p.unit,
      currentStock: p.initialStock,
      minStock: p.minStock,
      categoryId: categoryIdByName.get(data.categories[p.categoryIndex].name)!,
      showInCatalog: false,
    })),
    select: { id: true, sku: true },
  });
  const productIdBySku = new Map(products.map((p) => [p.sku!, p.id]));

  // Todo saldo muda via movimentação: o estoque inicial é a entrada do fornecedor do lote
  const movements = await tx.stockMovement.createMany({
    data: data.products.map((p) => ({
      productId: productIdBySku.get(p.sku)!,
      type: MovementType.IN,
      quantity: p.initialStock,
      reason: STOCK_REASON,
      unitCost: p.costPrice,
      userId: user.id,
      supplierId: supplierIdByDocument.get(data.suppliers[p.supplierIndex].document)!,
    })),
  });

  return {
    categories: categories.length,
    products: products.length,
    customers: customers.count,
    suppliers: suppliers.length,
    stockMovements: movements.count,
  } satisfies GeneratedCounts;
}

export type GenerateResult =
  { ok: true; counts: GeneratedCounts; replayed: boolean } | { ok: false; error: string };

/**
 * Gera dados de teste numa transação. O mesmo `requestId` repetido (clique duplo, resposta
 * perdida) devolve o resultado já gravado, sem gerar de novo.
 */
export async function generateTestData(
  user: SessionUser,
  rawRequestId: unknown,
  rawCounts: unknown,
  random: Random = Math.random,
): Promise<GenerateResult> {
  const requestId = parseOperationId(rawRequestId);
  if (!requestId) return { ok: false, error: INVALID_REQUEST };

  const validation = validateTestDataCounts(rawCounts);
  if (!validation.ok) {
    await recordUnsuccessfulRun(
      TestDataRunKind.GENERATE,
      TestDataRunStatus.REJECTED,
      user,
      validation.error,
      { requestId },
    );
    return { ok: false, error: validation.error };
  }
  const counts: TestDataCounts = validation.counts;

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(LOCK_SQL);

      const previous = await findCompletedRun(tx, requestId, TestDataRunKind.GENERATE);
      if (previous) {
        return { ok: true, counts: previous.counts as unknown as GeneratedCounts, replayed: true };
      }

      const data = buildTestData(counts, random);
      await resolveCollisions(tx, data, random);
      const created = await insertTestData(tx, user, data);

      await tx.testDataRun.create({
        data: {
          id: requestId,
          kind: TestDataRunKind.GENERATE,
          status: TestDataRunStatus.COMPLETED,
          userId: user.id,
          params: counts,
          counts: created,
        },
      });
      return { ok: true as const, counts: created, replayed: false };
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    if (error instanceof TestDataRejection) return { ok: false, error: error.message };
    console.error("Erro ao gerar dados de teste:", error);
    await recordUnsuccessfulRun(
      TestDataRunKind.GENERATE,
      TestDataRunStatus.FAILED,
      user,
      error instanceof Error ? error.message.slice(0, 500) : "Erro desconhecido",
      { requestId, ...counts },
    );
    return { ok: false, error: "Falha ao gerar os dados de teste. Nada foi gravado." };
  }
}

// Restauração

export interface OpenCashRegisterBlocker {
  id: string;
  userName: string;
  openedAt: string;
}

export interface PendingDeviceBlocker {
  deviceId: string;
  deviceName: string;
  userName: string;
  pending: number;
  reportedAt: string | null;
}

export interface ResetBlockers {
  openCashRegisters: OpenCashRegisterBlocker[];
  pendingDevices: PendingDeviceBlocker[];
}

export const hasBlockers = (blockers: ResetBlockers) =>
  blockers.openCashRegisters.length > 0 || blockers.pendingDevices.length > 0;

/**
 * Impedimentos da restauração: caixa aberto ou aparelho (não revogado) que informou vendas offline
 * ainda não enviadas. Um aparelho que nunca informou não aparece: o servidor não tem como saber.
 */
export async function getResetBlockers(db: Db = prisma): Promise<ResetBlockers> {
  const [registers, grants] = await Promise.all([
    db.cashRegister.findMany({
      where: { status: "OPEN" },
      orderBy: { openedAt: "asc" },
      select: { id: true, openedAt: true, user: { select: { name: true } } },
    }),
    db.offlineGrant.findMany({
      where: { pendingCount: { gt: 0 }, device: { revokedAt: null } },
      orderBy: { issuedAt: "desc" },
      select: {
        deviceId: true,
        pendingCount: true,
        pendingReportedAt: true,
        device: { select: { name: true } },
        user: { select: { name: true } },
      },
    }),
  ]);

  const devices = new Map<string, PendingDeviceBlocker>();
  for (const grant of grants) {
    const entry = devices.get(grant.deviceId) ?? {
      deviceId: grant.deviceId,
      deviceName: grant.device.name,
      userName: grant.user.name,
      pending: 0,
      reportedAt: null,
    };
    entry.pending += grant.pendingCount ?? 0;
    const reportedAt = grant.pendingReportedAt?.toISOString() ?? null;
    if (reportedAt && (!entry.reportedAt || reportedAt > entry.reportedAt)) {
      entry.reportedAt = reportedAt;
    }
    devices.set(grant.deviceId, entry);
  }

  return {
    openCashRegisters: registers.map((r) => ({
      id: r.id,
      userName: r.user.name,
      openedAt: r.openedAt.toISOString(),
    })),
    pendingDevices: [...devices.values()],
  };
}

async function countResetTables(tx: Tx): Promise<ResetCounts> {
  const columns = RESET_TABLES.map((t) => `(SELECT count(*) FROM "${t}")::int AS "${t}"`);
  const [row] = await tx.$queryRawUnsafe<ResetCounts[]>(`SELECT ${columns.join(", ")}`);
  return row;
}

/** Tentativas de confirmação erradas recentes do usuário (limite de tentativas). */
async function recentConfirmationFailures(userId: string, now: Date) {
  return prisma.testDataRun.count({
    where: {
      userId,
      kind: TestDataRunKind.RESET,
      status: TestDataRunStatus.REJECTED,
      createdAt: { gte: new Date(now.getTime() - RESET_CONFIRMATION_WINDOW_MS) },
      params: { path: ["reason"], equals: CONFIRMATION_REASON },
    },
  });
}

export interface ResetConfirmation {
  tradeName?: unknown;
  password?: unknown;
}

export type ResetResult =
  | { ok: true; counts: ResetCounts; replayed: boolean }
  | { ok: false; error: string; blockers?: ResetBlockers };

/**
 * Restaura o banco: apaga dados operacionais e cadastrais e mantém usuários, configurações da loja
 * e o histórico desta seção. Exige o nome fantasia da loja e a senha do usuário, e é recusada com
 * caixa aberto ou aparelho com vendas offline não enviadas.
 */
export async function resetStoreData(
  user: SessionUser,
  rawRequestId: unknown,
  confirmation: ResetConfirmation,
  now: Date = new Date(),
): Promise<ResetResult> {
  const requestId = parseOperationId(rawRequestId);
  if (!requestId) return { ok: false, error: INVALID_REQUEST };

  try {
    // Pedido já concluído (resposta perdida): devolve o resultado sem pedir confirmação de novo
    const previous = await prisma.testDataRun.findUnique({ where: { id: requestId } });
    if (previous) {
      if (previous.kind !== TestDataRunKind.RESET || previous.userId !== user.id) {
        return { ok: false, error: INVALID_REQUEST };
      }
      return { ok: true, counts: previous.counts as unknown as ResetCounts, replayed: true };
    }

    if ((await recentConfirmationFailures(user.id, now)) >= MAX_RESET_CONFIRMATION_FAILURES) {
      return {
        ok: false,
        error: "Muitas tentativas com nome da loja ou senha incorretos. Aguarde 15 minutos.",
      };
    }

    const [settings, account] = await Promise.all([
      prisma.storeSettings.findUnique({ where: { id: "default" }, select: { tradeName: true } }),
      prisma.user.findUnique({ where: { id: user.id }, select: { password: true } }),
    ]);
    if (!settings) {
      return {
        ok: false,
        error: "Salve as configurações da loja antes de restaurar o banco.",
      };
    }
    const tradeName = typeof confirmation.tradeName === "string" ? confirmation.tradeName : "";
    const password = typeof confirmation.password === "string" ? confirmation.password : "";
    const nameMatches = tradeName.trim() !== "" && tradeName.trim() === settings.tradeName.trim();
    // Compara a senha mesmo com o nome errado: o tempo de resposta não indica qual dos dois falhou
    const passwordMatches =
      !!account && password !== "" && (await bcrypt.compare(password, account.password));
    if (!nameMatches || !passwordMatches) {
      await recordUnsuccessfulRun(
        TestDataRunKind.RESET,
        TestDataRunStatus.REJECTED,
        user,
        CONFIRMATION_ERROR,
        { requestId, reason: CONFIRMATION_REASON },
      );
      return { ok: false, error: CONFIRMATION_ERROR };
    }

    return await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(RESET_LOCK_TIMEOUT_SQL);
      await tx.$executeRawUnsafe(LOCK_SQL);

      const replay = await findCompletedRun(tx, requestId, TestDataRunKind.RESET);
      if (replay) {
        return { ok: true, counts: replay.counts as unknown as ResetCounts, replayed: true };
      }

      // Trava as tabelas antes de conferir os impedimentos: nenhum caixa aberto ou venda nova
      // entra entre a conferência e o TRUNCATE
      const tables = RESET_TABLES.map((t) => `"${t}"`).join(", ");
      await tx.$executeRawUnsafe(`LOCK TABLE ${tables} IN ACCESS EXCLUSIVE MODE`);

      const blockers = await getResetBlockers(tx);
      if (hasBlockers(blockers)) {
        throw new TestDataRejection(
          "Há caixa aberto ou aparelho com vendas offline não enviadas. Resolva antes de restaurar.",
          blockers,
        );
      }

      const counts = await countResetTables(tx);
      // Lista fechada e sem CASCADE: o Postgres recusa se outra tabela depender destas
      await tx.$executeRawUnsafe(`TRUNCATE ${tables} RESTART IDENTITY`);

      await tx.testDataRun.create({
        data: {
          id: requestId,
          kind: TestDataRunKind.RESET,
          status: TestDataRunStatus.COMPLETED,
          userId: user.id,
          counts,
        },
      });
      return { ok: true as const, counts, replayed: false };
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    if (error instanceof TestDataRejection) {
      await recordUnsuccessfulRun(
        TestDataRunKind.RESET,
        TestDataRunStatus.REJECTED,
        user,
        error.message,
        { requestId, reason: "blocked" },
      );
      return { ok: false, error: error.message, blockers: error.blockers };
    }
    console.error("Erro ao restaurar o banco:", error);
    await recordUnsuccessfulRun(
      TestDataRunKind.RESET,
      TestDataRunStatus.FAILED,
      user,
      error instanceof Error ? error.message.slice(0, 500) : "Erro desconhecido",
      { requestId },
    );
    return { ok: false, error: `${GENERIC_ERROR} Nada foi apagado.` };
  }
}
