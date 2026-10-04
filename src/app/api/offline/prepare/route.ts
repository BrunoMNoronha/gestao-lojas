import { authorize } from "@/lib/authz";
import { OfflinePrepareError, prepareOfflineDevice } from "@/lib/offline-device";
import { NO_STORE, offlineAuthError, offlineError } from "@/lib/offline-http";

// POST /api/offline/prepare (issue #37, docs/OFFLINE.md seções 3.5 e 7). Corpo JSON:
// { "deviceId"?: "<id da preparação anterior>", "deviceName"?: "Chrome · Windows" }.
// Registra o aparelho (na primeira vez) e emite a autorização offline de 12 horas para o
// operador com o caixa aberto. Respostas: 401 sem sessão, 403 sem permissão ou aparelho
// revogado, 409 com o caixa fechado, 400 para corpo inválido, 503 se o banco falhar.

export async function POST(request: Request) {
  const authz = await authorize("pdv.use");
  if (!authz.ok) return offlineAuthError(authz);

  // Exigir JSON obriga o navegador a fazer a checagem de CORS antes de um envio de outro site
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return offlineError(400, "Envie os dados da preparação em JSON.");
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return offlineError(400, "Dados da preparação inválidos.");
  }
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  try {
    const preparation = await prepareOfflineDevice(authz.user, {
      deviceId: input.deviceId,
      deviceName: input.deviceName,
    });
    return Response.json(preparation, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof OfflinePrepareError) {
      return offlineError(error.status, error.message, error.code);
    }
    console.error("Erro ao preparar o PDV offline:", error);
    return offlineError(503, "Não foi possível preparar agora. Tente novamente em instantes.");
  }
}
