import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { NO_STORE, offlineAuthError, offlineError } from "@/lib/offline-http";
import {
  MAX_OPERATIONS_PER_BATCH,
  OFFLINE_OPERATIONS_PROTOCOL_VERSION,
  OFFLINE_SALE_PATHS,
  syncOfflineOperation,
  type OfflineOperationResult,
} from "@/lib/offline-sale";

// POST /api/offline/operations (issue #38, docs/OFFLINE.md seção 5). Corpo JSON:
// { "protocolVersion": 1, "operations": [<operação>, ...] } com até 50 operações do operador da
// sessão. Cada operação é aplicada (ou gravada como conflito) na própria transação, e a resposta
// traz o resultado de cada uma; reenviar o lote inteiro ou em parte é seguro (idempotência pela
// chave). Route Handler (e não Server Action) porque a fila do aparelho precisa continuar enviável
// depois de um deploy. Respostas: 200 com os resultados, 401 sem sessão, 403 sem permissão, 400
// para corpo inválido.

export async function POST(request: Request) {
  const authz = await authorize("pdv.use");
  if (!authz.ok) return offlineAuthError(authz);

  // Exigir JSON obriga o navegador a fazer a checagem de CORS antes de um envio de outro site
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return offlineError(400, "Envie as operações em JSON.");
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return offlineError(400, "Lote de operações inválido.");
  }
  const batch = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (batch.protocolVersion !== OFFLINE_OPERATIONS_PROTOCOL_VERSION) {
    return offlineError(400, "Versão do protocolo não suportada. Atualize o app.", "protocol");
  }
  const operations = batch.operations;
  if (!Array.isArray(operations) || operations.length === 0) {
    return offlineError(400, "O lote não tem operações.");
  }
  if (operations.length > MAX_OPERATIONS_PER_BATCH) {
    return offlineError(400, `Envie no máximo ${MAX_OPERATIONS_PER_BATCH} operações por lote.`);
  }

  // Em sequência: as operações do mesmo caixa seriam serializadas pela trava dele de qualquer forma
  const results: OfflineOperationResult[] = [];
  for (const operation of operations) {
    results.push(await syncOfflineOperation(authz.user, operation));
  }

  // Também num reenvio: a resposta original pode ter se perdido antes de atualizar as telas
  if (results.some((r) => r.status === "applied" || r.status === "approved")) {
    for (const path of OFFLINE_SALE_PATHS) revalidatePath(path);
  }

  return Response.json(
    { protocolVersion: OFFLINE_OPERATIONS_PROTOCOL_VERSION, results },
    { headers: NO_STORE },
  );
}
