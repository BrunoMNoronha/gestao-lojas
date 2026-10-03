import { testDatabaseUrl } from "./test-database";

// Roda antes de importar o código testado: o Prisma Client de src/lib/prisma.ts conecta no
// banco de teste (variáveis definidas aqui têm prioridade sobre um .env do projeto).
const url = testDatabaseUrl();
process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
