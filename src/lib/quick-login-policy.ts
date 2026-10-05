// Usado somente pelo servidor (página, provider e callbacks do Auth.js).
// NODE_ENV descreve o build; APP_ENV descreve o ambiente de implantação.
export function quickLoginContext(
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (env.ENABLE_DEV_QUICK_LOGIN !== "true") return null;
  const app = env.APP_ENV;
  if (!app || !["local", "test", "preview", "homologation"].includes(app)) return null;
  if (!["development", "test", "production"].includes(env.NODE_ENV ?? "")) return null;
  for (const signal of [env.VERCEL_ENV, env.VERCEL_TARGET_ENV]) {
    if (signal === undefined) continue;
    if (signal === "production") return null;
    if (signal === "preview" && app === "preview") continue;
    if (signal === "development" && app === "local") continue;
    return null;
  }
  // Exige confirmação do destino do banco, sem senha. Evita habilitar o atalho
  // ao trocar DATABASE_URL e mantém sessões de ambientes/bancos distintos separadas.
  try {
    const db = new URL(env.DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(db.protocol)) return null;
    const target = `${db.host}${db.pathname}`;
    if (env.DEV_QUICK_LOGIN_DATABASE !== target) return null;
    if (
      ["local", "test"].includes(app) &&
      !["localhost", "127.0.0.1", "[::1]"].includes(db.hostname)
    )
      return null;
    return `v1:${app}:${target}`;
  } catch {
    return null;
  }
}
