"use client";

import { useSyncExternalStore } from "react";

// Instalação do app (issue #61). O navegador avisa, com o evento `beforeinstallprompt`, que pode
// abrir a janela de instalação. O evento é guardado aqui, num estado único para todos os botões
// (menu do painel e cabeçalho do /pdv), e só é usado depois de um clique: `prompt()` abre a
// janela uma vez, e o evento usado é descartado. Aceitar a janela não prova que o app foi
// instalado: isso só vem com o evento `appinstalled`. A falta do evento não prova nada (o app pode
// já estar instalado, ou o navegador não oferece a janela, como o Safari): nesse caso a tela
// mostra a ajuda "Como instalar".
//
// Os ouvintes são registrados quando este módulo carrega no navegador (ele entra pelo layout
// raiz), para não perder um evento disparado antes de algum botão aparecer na tela.

/** Evento `beforeinstallprompt` (Chrome e Edge; não faz parte do DOM padrão do TypeScript). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

export interface InstallState {
  // Janela de instalação do navegador disponível (evento guardado e ainda não usado)
  canPrompt: boolean;
  // Janela aberta, esperando a resposta: impede um segundo clique
  prompting: boolean;
  // App aberto como app instalado (display-mode standalone ou navigator.standalone do iOS)
  standalone: boolean;
  // Instalação confirmada pelo navegador nesta sessão (`appinstalled`)
  installed: boolean;
}

export type PromptResult = "accepted" | "dismissed" | "unavailable" | "error";

/** Janela do navegador vista por este módulo: o suficiente para testar sem DOM. */
export interface InstallWindow {
  addEventListener(type: string, listener: (event: Event) => void): void;
  matchMedia?(query: string): {
    matches: boolean;
    addEventListener?(type: "change", listener: () => void): void;
  };
  navigator?: { standalone?: boolean };
}

const STANDALONE_QUERY = "(display-mode: standalone)";

export function createInstallStore(win: InstallWindow) {
  let deferred: BeforeInstallPromptEvent | null = null;
  const listeners = new Set<() => void>();
  const media = win.matchMedia?.(STANDALONE_QUERY);
  const isStandalone = () => !!media?.matches || win.navigator?.standalone === true;
  let state: InstallState = {
    canPrompt: false,
    prompting: false,
    standalone: isStandalone(),
    installed: false,
  };

  const set = (patch: Partial<InstallState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };

  win.addEventListener("beforeinstallprompt", (event) => {
    // Sem a janela automática do navegador: ela só abre pelo botão
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    set({ canPrompt: true });
  });
  win.addEventListener("appinstalled", () => {
    deferred = null;
    set({ installed: true, canPrompt: false });
  });
  media?.addEventListener?.("change", () => set({ standalone: isStandalone() }));

  /** Abre a janela de instalação do navegador. Chamar só a partir de um clique. */
  async function prompt(): Promise<PromptResult> {
    const event = deferred;
    if (!event || state.prompting) return "unavailable";
    // O evento vale para uma única janela: descartado antes de abrir
    deferred = null;
    set({ canPrompt: false, prompting: true });
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      return outcome;
    } catch {
      return "error";
    } finally {
      set({ prompting: false });
    }
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    prompt,
  };
}

type InstallStore = ReturnType<typeof createInstallStore>;

const store: InstallStore | null =
  typeof window === "undefined" ? null : createInstallStore(window as unknown as InstallWindow);

// No servidor e na hidratação, nada é oferecido: o estado real só existe no navegador
const SERVER_STATE: InstallState = {
  canPrompt: false,
  prompting: false,
  standalone: true,
  installed: false,
};
const noopSubscribe = () => () => {};

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.getState ?? (() => SERVER_STATE),
    () => SERVER_STATE,
  );
}

export function promptInstall(): Promise<PromptResult> {
  return store ? store.prompt() : Promise.resolve("unavailable");
}

export type InstallPlatform =
  "ios" | "android" | "desktop-chromium" | "mac-safari" | "firefox" | "other";

/** Plataforma para a ajuda "Como instalar", pelo user agent (só orienta; não libera nada). */
export function detectInstallPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform {
  // iPadOS se apresenta como Mac: a tela de toque denuncia
  const ios =
    /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (ios) return "ios";
  if (/Android/.test(userAgent)) return "android";
  if (/Firefox\//.test(userAgent)) return "firefox";
  if (/Edg\/|Chrome\//.test(userAgent)) return "desktop-chromium";
  if (/Macintosh/.test(userAgent) && /Safari\//.test(userAgent)) return "mac-safari";
  return "other";
}
