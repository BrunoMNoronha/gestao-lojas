import { authorize } from "@/lib/authz";
import { NO_STORE, offlineAuthError, offlineError } from "@/lib/offline-http";

// GET /api/offline/ping (issue #37, docs/OFFLINE.md seção 5, "Conectividade"). Sinal real de
// conexão com o serviço, em vez de navigator.onLine: 200 com o usuário da sessão (o aparelho
// confere se ainda é o mesmo operador), 401 sem sessão, 403 sem permissão e 503 se o banco
// falhar. Falha de rede ou tempo esgotado no aparelho = servidor inacessível.

export async function GET() {
  try {
    const authz = await authorize("pdv.use");
    if (!authz.ok) return offlineAuthError(authz);
    return Response.json(
      { ok: true, user: authz.user, serverTime: new Date().toISOString() },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("Erro ao conferir a conexão do PDV offline:", error);
    return offlineError(503, "Serviço indisponível no momento.");
  }
}
