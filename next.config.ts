import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

const nextConfig: NextConfig = {
  // Service Worker do PDV offline (issue #37): o navegador precisa buscar sempre a versão atual do
  // script para descobrir atualizações. O tipo e o escopo "/" (Service-Worker-Allowed) vêm da
  // própria rota gerada pelo Serwist (src/app/serwist/[path]/route.ts).
  async headers() {
    return [
      {
        source: "/serwist/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

// withSerwist só marca o esbuild como pacote externo do servidor (usado no build do SW)
export default withSerwist(nextConfig);
