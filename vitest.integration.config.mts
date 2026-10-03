import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Testes de integração com PostgreSQL real e descartável (issue #35). Uso:
//   TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/gestao_lojas_test" pnpm test:integration
// O global-setup aplica as migrations nesse banco e recusa qualquer banco que não seja local.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    setupFiles: ["tests/integration/setup-env.ts"],
    // Os arquivos compartilham o mesmo banco: um de cada vez
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
