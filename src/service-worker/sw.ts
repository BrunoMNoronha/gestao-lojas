/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { NetworkOnly, Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";

// Service Worker do PDV offline (issue #37, docs/OFFLINE.md seção 6.1). Empacotado pelo Serwist
// (src/app/serwist/[path]/route.ts) e servido em /serwist/sw.js com escopo "/".
//
// Guarda só arquivos da própria versão do app: _next/static (inclusive os carregados sob demanda),
// public/ (com o WASM do leitor de código) e as páginas estáticas /pdv e /offline, que não têm
// dados do usuário. As demais páginas e /api passam direto pela rede e nunca são guardadas: os
// dados do PDV ficam no IndexedDB, não no cache.

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: { cleanupOutdatedCaches: true },
  // A versão nova espera: o PDV mostra "Atualizar" e só troca quando o operador confirma, para
  // não apagar no meio do turno os arquivos que a página aberta ainda vai pedir.
  skipWaiting: false,
  clientsClaim: true,
  runtimeCaching: [
    {
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkOnly(),
    },
  ],
  // Navegação sem rede (ex.: recarregar uma página do painel) mostra a página de ajuda offline
  fallbacks: {
    entries: [{ url: "/offline", matcher: ({ request }) => request.destination === "document" }],
  },
});

serwist.addEventListeners();
