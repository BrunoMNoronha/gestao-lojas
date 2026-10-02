// Verificação do reCAPTCHA v3 (score) no servidor, chamada pelo login em src/auth.ts antes de
// qualquer acesso ao banco. Módulo comum (sem "use server"): não é exposto como Server Action.
//
// Variáveis:
// - RECAPTCHA_SECRET_KEY: chave secreta (só no servidor). Sem ela, em desenvolvimento a verificação
//   fica desligada (com aviso no log); em produção o login é recusado (fail closed).
// - RECAPTCHA_MIN_SCORE: score mínimo aceito (padrão 0.5).
// - RECAPTCHA_ALLOWED_HOSTNAMES: hosts aceitos, separados por vírgula. Se vazio, vale o host da
//   própria requisição de login.
//
// Nunca registre o token nem a chave secreta em log.

const SITEVERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const VERIFY_TIMEOUT_MS = 5000;
const DEFAULT_MIN_SCORE = 0.5;

export type RecaptchaResult =
  | { ok: true; skipped?: boolean }
  // "rejected": token ausente, inválido, reutilizado ou fora das regras (action, host, score).
  // "unavailable": chave ausente em produção ou Google fora do ar.
  | { ok: false; reason: "rejected" | "unavailable" };

interface SiteverifyResponse {
  success?: boolean;
  score?: number;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
}

let warnedDisabled = false;

function minScore(): number {
  const raw = process.env.RECAPTCHA_MIN_SCORE?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : DEFAULT_MIN_SCORE;
}

// O Next troca 127.0.0.1 e ::1 por "localhost" na URL da requisição, então os endereços de
// loopback são tratados como o mesmo host.
function normalizeHostname(host: string): string {
  const value = host.trim().toLowerCase();
  return value === "127.0.0.1" || value === "[::1]" || value === "::1" ? "localhost" : value;
}

function allowedHostnames(requestUrl: string): string[] {
  const configured = (process.env.RECAPTCHA_ALLOWED_HOSTNAMES ?? "")
    .split(",")
    .map(normalizeHostname)
    .filter(Boolean);
  if (configured.length > 0) return configured;
  try {
    return [normalizeHostname(new URL(requestUrl).hostname)];
  } catch {
    return [];
  }
}

export async function verifyRecaptcha(
  token: unknown,
  { requestUrl, expectedAction }: { requestUrl: string; expectedAction: string },
): Promise<RecaptchaResult> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[recaptcha] RECAPTCHA_SECRET_KEY não configurada em produção. Login bloqueado até a variável ser definida (ver docs/DEPLOY.md).",
      );
      return { ok: false, reason: "unavailable" };
    }
    if (!warnedDisabled) {
      warnedDisabled = true;
      console.warn(
        "[recaptcha] Chaves não configuradas: verificação desligada em desenvolvimento.",
      );
    }
    return { ok: true, skipped: true };
  }

  if (typeof token !== "string" || token.length === 0 || token.length > 4096) {
    console.warn("[recaptcha] Login recusado: token ausente ou malformado.");
    return { ok: false, reason: "rejected" };
  }

  let data: SiteverifyResponse;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = (await response.json()) as SiteverifyResponse;
  } catch (error) {
    const detail = error instanceof Error ? error.name : "erro desconhecido";
    console.error(`[recaptcha] Falha ao consultar o Google (${detail}). Login recusado.`);
    return { ok: false, reason: "unavailable" };
  }

  if (!data.success) {
    console.warn(
      `[recaptcha] Login recusado: token inválido (${(data["error-codes"] ?? []).join(", ") || "sem código"}).`,
    );
    return { ok: false, reason: "rejected" };
  }

  if (data.action !== expectedAction) {
    console.warn(`[recaptcha] Login recusado: action inesperada "${data.action ?? ""}".`);
    return { ok: false, reason: "rejected" };
  }

  const hostname = normalizeHostname(data.hostname ?? "");
  if (!allowedHostnames(requestUrl).includes(hostname)) {
    console.warn(`[recaptcha] Login recusado: hostname inesperado "${hostname}".`);
    return { ok: false, reason: "rejected" };
  }

  const required = minScore();
  if (typeof data.score !== "number" || data.score < required) {
    console.warn(
      `[recaptcha] Login recusado: score ${data.score ?? "ausente"} abaixo de ${required}.`,
    );
    return { ok: false, reason: "rejected" };
  }

  return { ok: true };
}
