"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { SerwistProvider } from "@serwist/turbopack/react";
import { Loader2 } from "lucide-react";
import type { StoreSettingsData } from "@/actions/settings";
import { PdvTerminal, type PdvCustomer, type PdvProduct } from "@/components/pdv-terminal";
import { readMeta, userDb } from "@/lib/offline/db";
import { useOfflinePdv } from "@/components/offline-pdv/use-offline-pdv";
import { OfflinePdvHeader } from "@/components/offline-pdv/offline-pdv-header";
import {
  BlockedState,
  ForbiddenState,
  PrepareState,
} from "@/components/offline-pdv/offline-pdv-states";
import type { OfflineStore } from "@/lib/offline-snapshot";

// PDV que abre sem rede (issue #37, docs/OFFLINE.md seção 6.2). Renderizado só no navegador: a
// página /pdv é estática e não leva dados do usuário; tudo vem do IndexedDB, atualizado pelos
// Route Handlers autenticados quando há conexão.

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "pt-BR");

// Dados da loja para o recibo; o Fiado não é oferecido no /pdv (docs/OFFLINE.md seção 3.4)
function toStoreSettings(store: OfflineStore | null): StoreSettingsData {
  const value = (v: string | null | undefined) => v ?? undefined;
  return {
    personType: store?.personType === "INDIVIDUAL" ? "INDIVIDUAL" : "COMPANY",
    companyName: store?.companyName ?? "",
    tradeName: store?.tradeName ?? "",
    document: value(store?.document),
    phone: value(store?.phone),
    zipCode: value(store?.zipCode),
    address: value(store?.address),
    number: value(store?.number),
    neighborhood: value(store?.neighborhood),
    city: value(store?.city),
    state: value(store?.state),
    receiptFooterNote: value(store?.receiptFooterNote),
    onAccountEnabled: false,
  };
}

function LocalTerminal({
  userId,
  online,
  onSaleCompleted,
}: {
  userId: string;
  online: boolean;
  onSaleCompleted: () => void;
}) {
  const db = userDb(userId);
  const data = useLiveQuery(async () => {
    const [products, customers, store, cashRegister] = await Promise.all([
      db.products.toArray(),
      db.customers.toArray(),
      readMeta(db, "store"),
      readMeta(db, "cashRegister"),
    ]);
    return { products, customers, store: store ?? null, cashRegister: cashRegister ?? null };
  }, [db]);

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
          currentStock: Number(p.currentStock),
        }))
        .sort(byName),
    [data?.products],
  );
  const customers = useMemo<PdvCustomer[]>(
    () =>
      (data?.customers ?? [])
        .map((c) => ({ id: c.id, name: c.name, document: c.document, phone: null }))
        .sort(byName),
    [data?.customers],
  );
  const storeSettings = useMemo(() => toStoreSettings(data?.store ?? null), [data?.store]);

  if (!data || !data.cashRegister) return <LoadingState />;
  return (
    <PdvTerminal
      products={products}
      customers={customers}
      storeSettings={storeSettings}
      cashRegisterId={data.cashRegister.id}
      offline={!online}
      onSaleCompleted={onSaleCompleted}
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
          <LocalTerminal userId={view.userId} online={pdv.online} onSaleCompleted={pdv.syncNow} />
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
