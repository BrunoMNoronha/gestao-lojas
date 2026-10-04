"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionUser } from "@/lib/authz";
import {
  endActiveOfflineSession,
  endOfflineSession,
  getActiveUserId,
  readMeta,
  userDb,
} from "@/lib/offline/db";
import { signOutClearingOfflineData } from "@/lib/offline/sign-out";
import {
  checkConnectivity,
  offlineBlock,
  OfflineRequestError,
  prepareDevice,
  syncSnapshot,
  type OfflineBlock,
} from "@/lib/offline/sync";

// Estado do PDV offline (issue #37): decide entre preparar, abrir com dados locais ou explicar a
// indisponibilidade, a partir da conexão real com o servidor e da preparação guardada.

export type PdvView =
  | { kind: "loading" }
  | { kind: "forbidden" }
  // Online, mas sem preparação válida para o usuário da sessão
  | { kind: "prepare"; user: SessionUser; reason: PrepareReason; error: string | null }
  // Sem conexão e sem preparação válida
  | { kind: "blocked"; reason: OfflineBlock }
  | { kind: "ready"; userId: string };

export type PrepareReason = "first" | "expired" | "cash_changed" | "cash_closed";

// Navegação completa até o login (como no próprio login-form): o login carrega o reCAPTCHA e,
// depois de entrar, volta ao PDV estático com o Service Worker no controle
const LOGIN_PATH = "/login?callbackUrl=%2Fpdv";
// eslint-disable-next-line @next/next/no-location-assign-relative-destination
const goToLogin = () => window.location.assign(LOGIN_PATH);

const PING_INTERVAL_MS = 30_000;
const SYNC_INTERVAL_MS = 2 * 60_000;

async function localBlock(userId: string) {
  const db = userDb(userId);
  const [grant, sync, cashRegister] = await Promise.all([
    readMeta(db, "grant"),
    readMeta(db, "sync"),
    readMeta(db, "cashRegister"),
  ]);
  return offlineBlock({ grant: grant ?? null, sync, cashRegister: cashRegister ?? null });
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof OfflineRequestError) return error.message;
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return "Sem espaço no aparelho para guardar os dados do PDV. Libere espaço e tente de novo.";
  }
  return fallback;
}

export function useOfflinePdv() {
  const [view, setViewState] = useState<PdvView>({ kind: "loading" });
  const [online, setOnline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const lastSyncAt = useRef(0);
  // Só o resultado da avaliação mais recente vale (as checagens periódicas podem se sobrepor), e
  // nenhuma avaliação muda a tela durante a preparação ou o encerramento
  const generation = useRef(0);
  const exclusive = useRef(false);
  const syncInFlight = useRef<Promise<boolean> | null>(null);

  const sync = useCallback((userId: string) => {
    syncInFlight.current ??= runSync(userId).finally(() => {
      syncInFlight.current = null;
    });
    return syncInFlight.current;

    async function runSync(id: string) {
      setSyncing(true);
      try {
        await syncSnapshot(id);
        lastSyncAt.current = Date.now();
        setSyncError(null);
        return true;
      } catch (error) {
        setSyncError(errorMessage(error, "Não foi possível sincronizar agora."));
        return false;
      } finally {
        setSyncing(false);
      }
    }
  }, []);

  /** Decide a tela a partir da conexão e da preparação guardada. */
  const evaluate = useCallback(async () => {
    if (exclusive.current) return;
    const current = ++generation.current;
    const isLatest = () => current === generation.current && !exclusive.current;
    const setView = (next: PdvView) => {
      if (isLatest()) setViewState(next);
    };
    try {
      const conn = await checkConnectivity();
      // Uma avaliação mais nova (ou a preparação) já assumiu: nada de apagar dados nem mudar a tela
      if (!isLatest()) return;
      setOnline(conn.status === "online");

      if (conn.status === "unauthenticated") {
        // Servidor acessível sem sessão: entrar de novo (a cópia fica até outro usuário entrar)
        goToLogin();
        return;
      }
      if (conn.status === "forbidden") {
        // Desmonta o terminal antes de apagar a cópia que ele está lendo
        setView({ kind: "forbidden" });
        await endActiveOfflineSession();
        return;
      }

      if (conn.status === "unreachable") {
        const active = await getActiveUserId();
        if (!active) {
          setView({ kind: "blocked", reason: "not_prepared" });
          return;
        }
        const block = await localBlock(active);
        setView(block ? { kind: "blocked", reason: block } : { kind: "ready", userId: active });
        return;
      }

      // Online: a sessão define o operador; a cópia de outro usuário é apagada
      const user = conn.user;
      const active = await getActiveUserId();
      if (active && active !== user.id && isLatest()) {
        setView({ kind: "loading" });
        await endOfflineSession(active);
      }
      const db = userDb(user.id);
      const grant = await readMeta(db, "grant");
      if (!grant) {
        setView({ kind: "prepare", user, reason: "first", error: null });
        return;
      }
      if (Date.now() - lastSyncAt.current > SYNC_INTERVAL_MS) await sync(user.id);

      const cashRegister = await readMeta(db, "cashRegister");
      const reason: PrepareReason | null = !cashRegister
        ? "cash_closed"
        : cashRegister.id !== grant.cashRegisterId
          ? "cash_changed"
          : new Date(grant.expiresAt).getTime() <= Date.now()
            ? "expired"
            : null;
      setView(
        reason
          ? { kind: "prepare", user, reason, error: null }
          : { kind: "ready", userId: user.id },
      );
    } catch (error) {
      console.error("Erro ao abrir o PDV offline:", error);
      setView({ kind: "blocked", reason: "incomplete" });
    }
  }, [sync]);

  const prepare = useCallback(
    async (user: SessionUser) => {
      exclusive.current = true;
      generation.current += 1;
      setViewState({ kind: "loading" });
      try {
        await prepareDevice(user.id);
        lastSyncAt.current = Date.now();
        setSyncError(null);
        exclusive.current = false;
        await evaluate();
      } catch (error) {
        exclusive.current = false;
        const code = error instanceof OfflineRequestError ? error.code : undefined;
        if (code === "unauthenticated") {
          goToLogin();
          return;
        }
        setViewState({
          kind: "prepare",
          user,
          reason: code === "cash_closed" ? "cash_closed" : "first",
          error: errorMessage(error, "Não foi possível preparar o aparelho. Tente de novo."),
        });
      }
    },
    [evaluate],
  );

  /** Sincronização manual (botão) ou depois de uma venda online. */
  const syncNow = useCallback(async () => {
    if (view.kind !== "ready") return;
    const ok = await sync(view.userId);
    if (ok) await evaluate();
  }, [evaluate, sync, view]);

  /** Sair do sistema (com conexão): apaga a cópia local e encerra a sessão. */
  const signOut = useCallback(async () => {
    exclusive.current = true;
    generation.current += 1;
    setViewState({ kind: "loading" });
    await signOutClearingOfflineData();
  }, []);

  /** Encerrar a operação offline neste aparelho (sair sem conexão). */
  const endLocalSession = useCallback(async () => {
    if (view.kind !== "ready") return;
    // Desmonta o terminal antes de apagar o banco que ele está lendo
    exclusive.current = true;
    generation.current += 1;
    setViewState({ kind: "loading" });
    try {
      await endOfflineSession(view.userId);
    } finally {
      exclusive.current = false;
      setViewState({ kind: "blocked", reason: "not_prepared" });
    }
  }, [view]);

  useEffect(() => {
    // Primeira avaliação logo ao abrir; depois, a cada intervalo e em cada mudança de rede
    const first = setTimeout(() => void evaluate(), 0);
    const timer = setInterval(() => void evaluate(), PING_INTERVAL_MS);
    const onChange = () => void evaluate();
    const onVisible = () => document.visibilityState === "visible" && void evaluate();
    window.addEventListener("online", onChange);
    window.addEventListener("offline", onChange);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("online", onChange);
      window.removeEventListener("offline", onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [evaluate]);

  return {
    view,
    online,
    syncing,
    syncError,
    prepare,
    syncNow,
    signOut,
    endLocalSession,
    retry: evaluate,
  };
}
