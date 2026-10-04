import type { AuthResult } from "@/lib/authz";

// Respostas dos Route Handlers do PDV offline (src/app/api/offline): nunca guardadas em cache,
// nem pelo navegador nem pelo Service Worker, e com o erro no corpo para a tela do aparelho.

export const NO_STORE = { "Cache-Control": "no-store" };

export function offlineError(status: number, error: string, code?: string) {
  return Response.json(code ? { error, code } : { error }, { status, headers: NO_STORE });
}

/** 401 sem sessão (o aparelho manda ao login) ou 403 sem permissão. */
export function offlineAuthError(authz: Extract<AuthResult, { ok: false }>) {
  return authz.code === "unauthenticated"
    ? offlineError(401, authz.error, "unauthenticated")
    : offlineError(403, authz.error, "forbidden");
}
