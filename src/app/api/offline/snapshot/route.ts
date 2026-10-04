import { authorize } from "@/lib/authz";
import { parseLimit, readOfflineSnapshot, SnapshotRequestError } from "@/lib/offline-snapshot";
import { NO_STORE, offlineAuthError, offlineError } from "@/lib/offline-http";

// GET /api/offline/snapshot?cursor=<cursor>&limit=<1..1000> (issue #36, docs/OFFLINE.md seção 5).
// Cópia mínima dos dados do PDV para o aparelho: sem cursor, carga completa; com o cursor da
// resposta anterior, só as alterações e exclusões. Route Handler (e não Server Action) porque o
// aparelho precisa continuar chamando depois de um deploy. O proxy não atua em /api: a sessão e a
// permissão são conferidas aqui.

export async function GET(request: Request) {
  const authz = await authorize("pdv.use");
  if (!authz.ok) return offlineAuthError(authz);

  const params = new URL(request.url).searchParams;
  try {
    const limit = parseLimit(params.get("limit"));
    const snapshot = await readOfflineSnapshot(authz.user, { cursor: params.get("cursor"), limit });
    return Response.json(snapshot, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SnapshotRequestError) return offlineError(400, error.message);
    console.error("Erro ao montar a cópia local do PDV:", error);
    return offlineError(503, "Não foi possível sincronizar agora. Tente novamente em instantes.");
  }
}
