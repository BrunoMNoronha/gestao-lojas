import { execFileSync } from "node:child_process";
import { testDatabaseUrl } from "../integration/test-database";

// Aplica as migrations no banco de teste e confere que ele ficou igual ao schema, como nos testes
// de integração (mesmo TEST_DATABASE_URL e mesmas regras de segurança). O Playwright carrega este
// arquivo como CommonJS, então a CLI do Prisma é localizada com require.resolve.
const prismaCli = require.resolve("prisma/build/index.js");

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

export default function globalSetup() {
  const url = testDatabaseUrl();
  // Logo após subir o container, o primeiro deploy pode terminar sem aplicar nada: tenta de novo
  for (let attempt = 1; attempt <= 2; attempt++) {
    prisma(["migrate", "deploy"], url);
    if (schemaMatches(url)) return;
  }
  throw new Error("O banco de teste não ficou igual a prisma/schema.prisma após as migrations.");
}
