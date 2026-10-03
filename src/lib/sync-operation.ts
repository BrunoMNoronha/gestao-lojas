import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

// Chave de idempotência das operações (issue #35, docs/OFFLINE.md seção 5). Usado apenas no
// servidor. A linha de SyncOperation é gravada na mesma transação dos efeitos da operação.

// Formato canônico de UUID (o mesmo aceito pela coluna "id" UUID do banco)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Normaliza o operationId recebido do cliente; devolve null se não for um UUID válido. */
export function parseOperationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return UUID_RE.test(id) ? id : null;
}

/**
 * SHA-256 (hex) do payload canônico. O chamador monta o payload já normalizado (valores
 * decimais como texto, listas em ordem estável), para que a mesma operação gere sempre o
 * mesmo hash, independentemente de como o cliente serializou os números.
 */
export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** Violação do índice único da chave da operação (duas gravações com o mesmo operationId). */
export function isDuplicateOperation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    error.meta?.modelName === "SyncOperation"
  );
}
