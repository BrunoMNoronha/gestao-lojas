"use client";

import { useCallback, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { SerwistProvider } from "@serwist/turbopack/react";
import { Loader2 } from "lucide-react";
import { PdvTerminal, type PdvCustomer, type PdvProduct } from "@/components/pdv-terminal";
import { readMeta, userDb } from "@/lib/offline/db";
import { recordSale } from "@/lib/offline/queue";
import {
  availableStock,
  reservedQuantities,
  SaleDraftError,
  toCompletedSale,
  type PdvSaleDraft,
  type SubmitSaleResult,
} from "@/lib/offline/sale-operation";
import { useOfflinePdv } from "@/components/offline-pdv/use-offline-pdv";
import { OfflinePdvHeader } from "@/components/offline-pdv/offline-pdv-header";
import { toStoreSettings } from "@/components/offline-pdv/store-settings";
import {
  BlockedState,
  ForbiddenState,
  PrepareState,
} from "@/components/offline-pdv/offline-pdv-states";

// PDV que abre sem rede (issue #37, docs/OFFLINE.md seção 6.2). Renderizado só no navegador: a
// página /pdv é estática e não leva dados do usuário; tudo vem do IndexedDB, atualizado pelos
// Route Handlers autenticados quando há conexão. Toda venda entra na fila do aparelho e é
// enviada pelo POST /api/offline/operations (#38), com ou sem conexão no momento da venda.

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "pt-BR");

// Com conexão, espera o envio por até 4 s para já mostrar o código oficial no recibo; depois
// disso o recibo sai provisório e o envio continua em segundo plano
const SEND_WAIT_MS = 4_000;
const wait = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

function saleErrorMessage(error: unknown): string {
  if (error instanceof SaleDraftError) return `${error.message} O carrinho foi mantido.`;
  const names = [
    (error as { name?: string })?.name,
    (error as { inner?: { name?: string } })?.inner?.name,
  ];
  if (names.includes("QuotaExceededError")) {
    return "Sem espaço no aparelho para guardar a venda. Libere espaço e tente de novo: o carrinho foi mantido e a venda não foi registrada.";
  }
  return "Não foi possível guardar a venda neste aparelho. O carrinho foi mantido e a venda não foi registrada.";
}

function LocalTerminal({
  userId,
  online,
  sendAfterSale,
}: {
  userId: string;
  online: boolean;
  sendAfterSale: (userId: string) => Promise<unknown>;
}) {
  const db = userDb(userId);
  const data = useLiveQuery(async () => {
    const [products, customers, store, cashRegister, sync, operations] = await Promise.all([
      db.products.toArray(),
      db.customers.toArray(),
      readMeta(db, "store"),
      readMeta(db, "cashRegister"),
      readMeta(db, "sync"),
      db.operations.toArray(),
    ]);
    return {
      products,
      customers,
      store: store ?? null,
      cashRegister: cashRegister ?? null,
      watermark: sync?.watermark ?? null,
      operations,
    };
  }, [db]);

  // Saldo disponível = saldo da cópia menos as vendas da fila que ela ainda não mostra
  // (docs/OFFLINE.md seção 3.2): o terminal não deixa vender além disso
  const reserved = useMemo(
    () => reservedQuantities(data?.operations ?? [], data?.watermark),
    [data?.operations, data?.watermark],
  );
  const products = useMemo<PdvProduct[]>(
    () =>
      (data?.products ?? [])
        .map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          barcode: p.barcode,
          salePrice: Number(p.salePrice),
          unit: p.unit,
          currentStock: availableStock(p.currentStock, reserved.get(p.id)),
        }))
        .sort(byName),
    [data?.products, reserved],
  );
  const customers = useMemo<PdvCustomer[]>(
    () =>
      (data?.customers ?? [])
        .map((c) => ({ id: c.id, name: c.name, document: c.document, phone: null }))
        .sort(byName),
    [data?.customers],
  );
  const storeSettings = useMemo(() => toStoreSettings(data?.store), [data?.store]);

  const submitSale = useCallback(
    async (draft: PdvSaleDraft): Promise<SubmitSaleResult> => {
      let id: string;
      try {
        id = (await recordSale(userId, draft)).id;
      } catch (error) {
        console.error("Falha ao guardar a venda no aparelho:", error);
        return { success: false, error: saleErrorMessage(error) };
      }
      // A venda já está guardada: daqui em diante nada desfaz a confirmação
      try {
        await Promise.race([sendAfterSale(userId), wait(SEND_WAIT_MS)]);
      } catch (error) {
        console.error("Falha ao enviar a venda:", error);
      }
      const op = await db.operations.get(id);
      if (!op) return { success: false, error: "A venda não foi encontrada no aparelho." };
      return { success: true, sale: toCompletedSale(op) };
    },
    [db, sendAfterSale, userId],
  );

  if (!data || !data.cashRegister) return <LoadingState />;
  return (
    <PdvTerminal
      products={products}
      customers={customers}
      storeSettings={storeSettings}
      cashRegisterId={data.cashRegister.id}
      offline={!online}
      submitSale={submitSale}
      className="lg:h-[calc(100svh-8.5rem)]"
    />
  );
}

function LoadingState() {
  return (
    <div className="text-muted-foreground flex min-h-[60vh] items-center justify-center gap-2 text-sm">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      Carregando o PDV...
    </div>
  );
}

function OfflinePdv() {
  const pdv = useOfflinePdv();
  const { view } = pdv;
  const userId = view.kind === "ready" ? view.userId : null;

  return (
    <div className="bg-background flex min-h-screen flex-col">
      <OfflinePdvHeader
        userId={userId}
        queueUserId={pdv.queueUserId}
        sessionUser={pdv.sessionUser}
        online={pdv.online}
        syncing={pdv.syncing}
        syncError={pdv.syncError}
        onSync={pdv.syncNow}
        onSignOut={pdv.signOut}
        onEndLocalSession={pdv.endLocalSession}
      />
      <main id="conteudo" className="min-w-0 flex-1 p-4 sm:p-6">
        {view.kind === "loading" && <LoadingState />}
        {view.kind === "forbidden" && <ForbiddenState />}
        {view.kind === "prepare" && (
          <PrepareState
            reason={view.reason}
            error={view.error}
            onPrepare={() => pdv.prepare(view.user)}
          />
        )}
        {view.kind === "blocked" && <BlockedState reason={view.reason} onRetry={pdv.retry} />}
        {view.kind === "ready" && (
          <LocalTerminal
            userId={view.userId}
            online={pdv.online}
            sendAfterSale={pdv.sendAfterSale}
          />
        )}
      </main>
    </div>
  );
}

export default function PdvOfflineApp() {
  return (
    // Registra o Service Worker (escopo "/"). Em desenvolvimento fica desligado, para não guardar
    // arquivos do servidor de desenvolvimento. Nada de cache por navegação nem recarga automática.
    <SerwistProvider
      swUrl="/serwist/sw.js"
      disable={process.env.NODE_ENV === "development"}
      cacheOnNavigation={false}
      reloadOnOnline={false}
    >
      <OfflinePdv />
    </SerwistProvider>
  );
}
