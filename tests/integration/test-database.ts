// Banco usado pelos testes de integração. Só aceita PostgreSQL local com "test" no nome do
// banco, para que um TEST_DATABASE_URL errado nunca apague dados de desenvolvimento ou produção.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function testDatabaseUrl(): string {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    throw new Error(
      "Defina TEST_DATABASE_URL com um PostgreSQL local e descartável (veja o README, seção Testes).",
    );
  }
  const url = new URL(raw);
  const database = url.pathname.replace(/^\//, "");
  if (!LOCAL_HOSTS.has(url.hostname) || !/test/i.test(database)) {
    throw new Error(
      `TEST_DATABASE_URL recusado (${url.hostname}/${database}): use um banco local com "test" no nome.`,
    );
  }
  return raw;
}
