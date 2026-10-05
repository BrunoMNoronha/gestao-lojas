// A conexão direta das migrations nunca passa por este helper.
export function runtimeDatabaseUrl(value: string | undefined): string | undefined {
  if (!value) return value;
  const url = new URL(value);
  if (!url.hostname.includes("-pooler.")) return value;
  for (const [key, defaultValue] of Object.entries({
    pgbouncer: "true",
    connection_limit: "5",
    pool_timeout: "10",
  })) {
    if (!url.searchParams.has(key)) url.searchParams.set(key, defaultValue);
  }
  return url.toString();
}
