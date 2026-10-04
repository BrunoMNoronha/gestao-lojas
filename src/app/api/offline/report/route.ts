import { authorize } from "@/lib/authz";
import { NO_STORE, offlineAuthError, offlineError } from "@/lib/offline-http";
import { PendingReportError, reportPendingSales } from "@/lib/offline-pending";

// POST /api/offline/report (issue #38, docs/OFFLINE.md seção 3.3). Corpo JSON:
// { "deviceId": "<aparelho>", "grants": [{ "grantId": "<autorização>", "pending": 2 }] }.
// O aparelho informa quantas vendas de cada autorização ainda não chegaram ao servidor, para o
// fechamento do caixa avisar. Respostas: 200, 401 sem sessão, 403 sem permissão, 400 para corpo
// inválido, 503 se o banco falhar.

export async function POST(request: Request) {
  const authz = await authorize("pdv.use");
  if (!authz.ok) return offlineAuthError(authz);

  // Exigir JSON obriga o navegador a fazer a checagem de CORS antes de um envio de outro site
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return offlineError(400, "Envie o informe em JSON.");
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return offlineError(400, "Informe de pendências inválido.");
  }

  try {
    const result = await reportPendingSales(authz.user, body);
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof PendingReportError) return offlineError(400, error.message);
    console.error("Erro ao gravar o informe de pendências offline:", error);
    return offlineError(503, "Não foi possível gravar o informe agora.");
  }
}
