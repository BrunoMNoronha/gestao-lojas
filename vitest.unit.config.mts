import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Testes unitários sem banco (issue #38): regras do navegador, como a fila de vendas do /pdv, com
// o IndexedDB simulado pelo fake-indexeddb. Uso: pnpm test:unit
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["fake-indexeddb/auto"],
  },
});
