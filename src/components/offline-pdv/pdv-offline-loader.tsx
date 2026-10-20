"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

// Carrega o PDV offline só no navegador (guia de SPA do Next: next/dynamic com ssr: false). O
// IndexedDB e o Service Worker não existem no servidor, e o HTML estático fica sem dados.
const PdvOfflineApp = dynamic(() => import("@/components/offline-pdv/pdv-offline-app"), {
  ssr: false,
  loading: () => (
    <div className="text-muted-foreground flex min-h-screen items-center justify-center gap-2 text-sm">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      Carregando o PDV...
    </div>
  ),
});

export function PdvOfflineLoader() {
  return <PdvOfflineApp />;
}
