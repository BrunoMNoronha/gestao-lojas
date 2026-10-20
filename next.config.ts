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
      // Vídeo da landing: nome versionado (-vN), então pode ficar em cache por 1 ano
      {
        source: "/videos/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      // GPS só para o próprio site (carrinho do catálogo, entrega); iframes de terceiros ficam sem
      {
        source: "/:path*",
        headers: [{ key: "Permissions-Policy", value: "geolocation=(self)" }],
      },
    ];
  },
};

// withSerwist só marca o esbuild como pacote externo do servidor (usado no build do SW)
export default withSerwist(nextConfig);
