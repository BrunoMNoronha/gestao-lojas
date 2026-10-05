import { openPdvBoxes } from "@/actions/unpack";
import type { UnpackInput, UnpackResult } from "@/lib/unpack";
import type { PdvProduct } from "@/components/pdv-terminal";
import { readMeta, userDb } from "@/lib/offline/db";
import { sendQueue } from "@/lib/offline/queue";
import { availableStock, reservedQuantities } from "@/lib/offline/sale-operation";
import { checkConnectivity, offlineBlock, syncSnapshot } from "@/lib/offline/sync";
import { withPdvStockLock } from "@/lib/offline/stock-lock";

type UnpackSuccess = Extract<UnpackResult, { success: true }>["data"];

async function requireOnlineOperator(userId: string) {
  const connection = await checkConnectivity();
  if (connection.status !== "online")
    throw new Error("Abrir uma caixa exige conexão com o servidor.");
  if (connection.user.id !== userId)
    throw new Error("A sessão mudou de operador. Entre de novo antes de abrir caixas.");
}

async function currentProducts(userId: string): Promise<PdvProduct[]> {
  const db = userDb(userId);
  const [products, operations, sync] = await Promise.all([
    db.products.toArray(),
    db.operations.toArray(),
    readMeta(db, "sync"),
  ]);
  const reserved = reservedQuantities(operations, sync?.watermark);
  return products
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      unit: p.unit,
      salePrice: Number(p.salePrice),
      currentStock: availableStock(p.currentStock, reserved.get(p.id)),
      containedProductId: p.containedProductId ?? null,
      unitsPerBox: p.unitsPerBox ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

async function preflight(userId: string, replay = false) {
  await requireOnlineOperator(userId);
  const summary = await sendQueue(userId, { includeConflicts: true, report: true });
  if (summary.status !== "done")
    throw new Error(
      "Não foi possível concluir o envio das vendas. Sincronize a fila antes de abrir caixas.",
    );
  const db = userDb(userId);
  const operations = await db.operations.toArray();
  if (operations.some((op) => op.status !== "synced" && op.status !== "discarded")) {
    throw new Error(
      "Há vendas pendentes, em conflito ou recusadas neste aparelho. Resolva a fila antes de abrir caixas.",
    );
  }
  // Chamada dentro da trava de estoque: não disputa com a leitura periódica de outra aba.
  await syncSnapshot(userId, { stockLockHeld: true });
  const [grant, sync, cashRegister] = await Promise.all([
    readMeta(db, "grant"),
    readMeta(db, "sync"),
    readMeta(db, "cashRegister"),
  ]);
  if (!replay && offlineBlock({ grant: grant ?? null, sync, cashRegister: cashRegister ?? null })) {
    throw new Error("Prepare novamente o aparelho e confira o caixa antes de abrir caixas.");
  }
  return currentProducts(userId);
}

export function prepareLocalUnpack(userId: string): Promise<PdvProduct[]> {
  return withPdvStockLock(
    userId,
    async () => {
      if (await readMeta(userDb(userId), "unpackPending")) {
        throw new Error("Verifique a abertura pendente antes de iniciar outra abertura.");
      }
      return preflight(userId);
    },
    true,
  );
}

export function confirmLocalUnpack(userId: string, input: UnpackInput): Promise<UnpackResult> {
  return withPdvStockLock(
    userId,
    async () => {
      const db = userDb(userId);
      const pending = await readMeta(db, "unpackPending");
      if (pending && pending.operationId !== input.operationId) {
        return {
          success: false,
          error: "Existe outra abertura pendente neste aparelho. Verifique-a primeiro.",
        };
      }
      // Até o reenvio de uma chave incerta exige rede e envio da fila, sem gravar conversão local.
      const products = await preflight(userId, !!pending);
      const pendingOperation = {
        operationId: input.operationId,
        boxProductId: input.boxProductId,
        unitProductId: input.expectedUnitProductId,
        input,
        boxName:
          products.find((p) => p.id === input.boxProductId)?.name ?? pending?.boxName ?? "Caixa",
        unitName:
          products.find((p) => p.id === input.expectedUnitProductId)?.name ??
          pending?.unitName ??
          "Avulso",
      };
      await db.meta.put({ key: "unpackPending", value: pendingOperation });
      const result = await openPdvBoxes(input);
      if (result.success) {
        await db.meta.put({
          key: "unpackPending",
          value: { ...pendingOperation, data: result.data },
        });
      } else if (!result.uncertain) {
        await db.meta.put({ key: "unpackPending", value: null });
      }
      return result;
    },
    true,
  );
}

export function refreshLocalUnpack(userId: string, data: UnpackSuccess): Promise<PdvProduct[]> {
  return withPdvStockLock(
    userId,
    async () => {
      await requireOnlineOperator(userId);
      await syncSnapshot(userId, { stockLockHeld: true });
      const db = userDb(userId);
      const sync = await readMeta(db, "sync");
      // Uma transação antiga ainda aberta pode manter o limite seguro atrás da conversão.
      // Não inferimos saldos: o snapshot precisa provar que já inclui a abertura confirmada.
      if (!sync?.watermark || BigInt(sync.watermark) <= BigInt(data.appliedTxid)) {
        throw new Error(
          "A caixa já foi aberta, mas os saldos ainda não chegaram à cópia. Atualize os saldos novamente; a caixa não será aberta outra vez.",
        );
      }
      const products = await currentProducts(userId);
      await db.meta.put({ key: "unpackPending", value: null });
      return products;
    },
    true,
  );
}
