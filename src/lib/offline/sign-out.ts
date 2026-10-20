import { signOut } from "next-auth/react";

// Saída do sistema (issue #37, docs/OFFLINE.md seção 7): antes de encerrar a sessão, apaga a cópia
// local do PDV offline do operador. A fila pendente, se houver, é mantida. O Dexie só é carregado
// aqui, sob demanda, para não pesar nas demais páginas.
export async function signOutClearingOfflineData() {
  try {
    const { endActiveOfflineSession } = await import("@/lib/offline/db");
    await endActiveOfflineSession();
  } catch (error) {
    // IndexedDB bloqueado ou indisponível: a sessão é encerrada mesmo assim, e o próximo login
    // de outro usuário apaga a cópia (OfflineUserGuard)
    console.error("Não foi possível apagar a cópia local do PDV:", error);
  }
  await signOut({ callbackUrl: "/login" });
}
