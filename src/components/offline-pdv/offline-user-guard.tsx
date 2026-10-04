"use client";

import { useEffect } from "react";

// Troca de usuário no aparelho (issue #37, docs/OFFLINE.md seção 7): se outro usuário entrou sem
// que o anterior tivesse saído (sessão expirada, login por cima), a cópia local do PDV do
// operador anterior é apagada assim que o painel abre. Não renderiza nada.
export function OfflineUserGuard({ userId }: { userId: string }) {
  useEffect(() => {
    if (typeof indexedDB === "undefined") return;
    import("@/lib/offline/db")
      .then(({ endOfflineSessionIfOtherUser }) => endOfflineSessionIfOtherUser(userId))
      .catch((error) => console.error("Não foi possível conferir a cópia local do PDV:", error));
  }, [userId]);
  return null;
}
