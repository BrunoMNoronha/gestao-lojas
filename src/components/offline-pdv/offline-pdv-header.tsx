"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useSerwist } from "@serwist/turbopack/react";
import { ArrowLeft, Cloud, CloudOff, Download, LogOut, RefreshCw, Store } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { OfflineQueuePanel } from "@/components/offline-pdv/offline-queue-panel";
import { AssistedQueuePanel } from "@/components/offline-pdv/assisted-queue-panel";
import { OfflineStockPanel } from "@/components/offline-pdv/offline-stock-panel";
import { StorageWarning } from "@/components/offline-pdv/storage-warning";
import { InstallAppButton } from "@/components/install-app-button";
import type { SessionUser } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { readMeta, userDb } from "@/lib/offline/db";
import { MAX_DATA_AGE_MS } from "@/lib/offline/sync";
import { formatStoreDateTime } from "@/lib/store-time";
import { cn } from "@/lib/utils";

// Cabeçalho do /pdv (issue #37): conexão real com o serviço, última sincronização e idade dos
// dados, validade da autorização offline, arquivos do app guardados e atualização de versão. Dá
// acesso à fila de vendas (#38) e à consulta de estoque (#54).

function formatAge(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `há ${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}

// Relógio da tela, atualizado a cada minuto (idade dos dados e validade da autorização)
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Service Worker ativo controlando a página e versão nova à espera. */
function useAppUpdate() {
  const { serwist } = useSerwist();
  const [controlled, setControlled] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const updating = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;
    let registration: ServiceWorkerRegistration | undefined;
    // Versão nova à espera só conta como atualização se já houver uma versão no controle. A
    // consulta direta ao registro cobre a versão que já esperava antes de a tela abrir (o evento
    // "waiting" do Serwist pode disparar antes deste efeito).
    const check = () => setWaiting(!!registration?.waiting && !!sw.controller);
    const onUpdateFound = () => registration?.installing?.addEventListener("statechange", check);
    sw.getRegistration().then((reg) => {
      registration = reg;
      check();
      reg?.addEventListener("updatefound", onUpdateFound);
    });
    sw.ready.then(() => setControlled(!!sw.controller));
    const onControllerChange = () => {
      setControlled(true);
      // A versão nova assumiu depois do "Atualizar": recarrega com os arquivos novos; os dados
      // locais (IndexedDB) ficam intactos
      if (updating.current) window.location.reload();
    };
    sw.addEventListener("controllerchange", onControllerChange);
    return () => {
      registration?.removeEventListener("updatefound", onUpdateFound);
      sw.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  useEffect(() => {
    if (!serwist) return;
    const onWaiting = () => setWaiting(true);
    serwist.addEventListener("waiting", onWaiting);
    return () => serwist.removeEventListener("waiting", onWaiting);
  }, [serwist]);

  const update = async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.waiting) return;
    updating.current = true;
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  };

  return { controlled, waiting, update };
}

interface OfflinePdvHeaderProps {
  userId: string | null;
  // Operador cuja fila de vendas aparece (também fora do terminal, ex.: caixa fechado)
  queueUserId: string | null;
  // Usuário da sessão (só com conexão): o gerente vê as vendas de outros operadores
  sessionUser: SessionUser | null;
  online: boolean;
  syncing: boolean;
  syncError: string | null;
  onSync: () => void;
  onSignOut: () => void;
  onEndLocalSession: () => void;
}

export function OfflinePdvHeader({
  userId,
  queueUserId,
  sessionUser,
  online,
  syncing,
  syncError,
  onSync,
  onSignOut,
  onEndLocalSession,
}: OfflinePdvHeaderProps) {
  const now = useNow();
  const app = useAppUpdate();
  const [askConfirm, confirmDialog] = useConfirm();

  const confirmEndLocalSession = async () => {
    const ok = await askConfirm({
      title: "Encerrar o PDV neste aparelho?",
      description:
        "Os produtos, clientes e a autorização guardados aqui serão apagados. As vendas ainda não enviadas continuam guardadas e são enviadas quando você entrar de novo, com conexão. Para usar o PDV de novo é preciso internet e uma nova preparação.",
      confirmLabel: "Encerrar",
      destructive: true,
    });
    if (ok) onEndLocalSession();
  };
  const meta = useLiveQuery(async () => {
    if (!userId) return null;
    const db = userDb(userId);
    const [user, store, sync, grant, persisted] = await Promise.all([
      readMeta(db, "user"),
      readMeta(db, "store"),
      readMeta(db, "sync"),
      readMeta(db, "grant"),
      readMeta(db, "persisted"),
    ]);
    return { user, store, sync, grant, persisted };
  }, [userId]);

  const storeName = meta?.store?.tradeName || meta?.store?.companyName || "Frente de Caixa";
  const age = meta?.sync?.syncedAt ? now - meta.sync.syncedAt : null;
  const expiresAt = meta?.grant ? new Date(meta.grant.expiresAt).getTime() : null;

  return (
    <header className="bg-card border-b px-4 py-2 sm:px-6">
      {confirmDialog}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <Store className="text-primary h-5 w-5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{storeName}</p>
            {meta?.user && (
              <p className="text-muted-foreground truncate text-xs">{meta.user.name}</p>
            )}
          </div>
        </div>

        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
              online ? "bg-success/10 text-success" : "bg-warning/10 text-warning",
            )}
          >
            {online ? <Cloud className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
            {online ? "Conectado ao servidor" : "Sem conexão com o servidor"}
          </span>
          {meta?.sync?.syncedAt && age !== null && (
            <span
              className={cn("text-muted-foreground", age > MAX_DATA_AGE_MS && "text-destructive")}
            >
              Dados de {formatStoreDateTime(new Date(meta.sync.syncedAt).toISOString())} (
              {formatAge(age)})
            </span>
          )}
          {expiresAt !== null && (
            <span className={cn("text-muted-foreground", expiresAt <= now && "text-destructive")}>
              {expiresAt > now
                ? `Uso sem internet até ${formatStoreDateTime(meta!.grant!.expiresAt)}`
                : "Autorização sem internet vencida"}
            </span>
          )}
          {userId && !app.controlled && (
            <span className="text-muted-foreground">Guardando o app no aparelho...</span>
          )}
          {meta && meta.persisted === false && <StorageWarning />}
          {syncError && online && <span className="text-destructive">{syncError}</span>}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {sessionUser && can(sessionUser.role, "offline.reconcile") && (
            <AssistedQueuePanel sessionUserId={sessionUser.id} />
          )}
          {userId && (
            <OfflineStockPanel
              userId={userId}
              online={online}
              canManageStock={!!sessionUser && can(sessionUser.role, "stock.manage")}
            />
          )}
          {queueUserId && (
            <OfflineQueuePanel
              userId={queueUserId}
              online={online}
              busy={syncing}
              onSend={onSync}
            />
          )}
          <InstallAppButton variant="pdv" />
          {app.waiting && (
            <Button size="sm" className="gap-1.5" onClick={app.update}>
              <Download className="h-4 w-4" />
              Atualizar o app
            </Button>
          )}
          {(userId || queueUserId) && online && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={onSync}
              disabled={syncing}
            >
              <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
              Sincronizar
            </Button>
          )}
          {/* Navegação completa: sem rede, o Service Worker mostra a página offline */}
          <a href="/admin" className={buttonVariants({ size: "sm", variant: "ghost" })}>
            <ArrowLeft className="h-4 w-4" />
            Painel
          </a>
          {online ? (
            <Button
              size="sm"
              variant="ghost"
              className="hover:text-destructive gap-1.5"
              onClick={onSignOut}
            >
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
          ) : (
            userId && (
              <Button
                size="sm"
                variant="ghost"
                className="hover:text-destructive gap-1.5"
                onClick={confirmEndLocalSession}
              >
                <LogOut className="h-4 w-4" />
                Encerrar neste aparelho
              </Button>
            )
          )}
        </div>
      </div>
    </header>
  );
}
