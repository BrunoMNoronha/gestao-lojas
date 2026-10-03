import { authorize } from "@/lib/authz";
import { parseLimit, readOfflineSnapshot, SnapshotRequestError } from "@/lib/offline-snapshot";

// GET /api/offline/snapshot?cursor=<cursor>&limit=<1..1000> (issue #36, docs/OFFLINE.md seção 5).
// Cópia mínima dos dados do PDV para o aparelho: sem cursor, carga completa; com o cursor da
// resposta anterior, só as alterações e exclusões. Route Handler (e não Server Action) porque o
// aparelho precisa continuar chamando depois de um deploy. O proxy não atua em /api: a sessão e a
// permissão são conferidas aqui.

const NO_STORE = { "Cache-Control": "no-store" };

function fail(status: number, error: string) {
  return Response.json({ error }, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const authz = await authorize("pdv.use");
  if (!authz.ok) return fail(authz.code === "unauthenticated" ? 401 : 403, authz.error);

  const params = new URL(request.url).searchParams;
  try {
    const limit = parseLimit(params.get("limit"));
    const snapshot = await readOfflineSnapshot(authz.user, { cursor: params.get("cursor"), limit });
    return Response.json(snapshot, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SnapshotRequestError) return fail(400, error.message);
    console.error("Erro ao montar a cópia local do PDV:", error);
    return fail(503, "Não foi possível sincronizar agora. Tente novamente em instantes.");
  }
}
