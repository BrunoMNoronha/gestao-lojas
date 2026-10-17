import { testDatabaseUrl } from "./test-database";

// Roda antes de importar o código testado: o Prisma Client de src/lib/prisma.ts conecta no
// banco de teste (variáveis definidas aqui têm prioridade sobre um .env do projeto).
const url = testDatabaseUrl();
process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
// Dados de teste (issue #67): ligados nos testes; cada teste de ambiente desliga por conta própria
process.env.ENABLE_STORE_TEST_TOOLS = "true";
// Chave do link criptografado do pedido do catálogo (src/lib/order-link.ts, issue #81)
process.env.AUTH_SECRET ??= "segredo-de-teste-da-integracao";
