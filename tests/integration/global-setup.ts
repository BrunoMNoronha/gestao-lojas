import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { testDatabaseUrl } from "./test-database";

// CLI do Prisma chamada pelo Node, sem shell (o pnpm é um .cmd no Windows)
const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");

// Aplica as migrations no banco de teste (as mesmas de produção, via `prisma migrate deploy`)
// e confere que o banco ficou igual ao schema antes de rodar os testes.
function prisma(args: string[], url: string) {
  return execFileSync(process.execPath, [prismaCli, ...args], {
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: "pipe",
  });
}

function schemaMatches(url: string): boolean {
  try {
    prisma(
      [
        "migrate",
        "diff",
        "--from-url",
        url,
        "--to-schema-datamodel",
        "prisma/schema.prisma",
        "--exit-code",
      ],
      url,
    );
    return true;
  } catch {
    return false;
  }
}

export default function setup() {
  const url = testDatabaseUrl();
  // Logo após subir o container, o primeiro deploy pode terminar sem aplicar nada: tenta de novo
  for (let attempt = 1; attempt <= 2; attempt++) {
    prisma(["migrate", "deploy"], url);
    if (schemaMatches(url)) return;
  }
  throw new Error("O banco de teste não ficou igual a prisma/schema.prisma após as migrations.");
}
