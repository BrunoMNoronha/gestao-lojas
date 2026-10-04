import { createHash } from "node:crypto";
import { createSerwistRoute } from "@serwist/turbopack";

// Gera o Service Worker no build (issue #37, docs/OFFLINE.md seção 6.1) e o serve em
// /serwist/sw.js como arquivo estático. O cabeçalho Cache-Control: no-cache fica no next.config.ts.

// Páginas estáticas guardadas para abrir sem rede. Elas não têm arquivo com hash no nome, então a
// revisão precisa mudar a cada versão do app: o commit publicado na Vercel ou, fora dela, o hash
// da lista de arquivos do build.
const OFFLINE_PAGES = ["/pdv", "/offline"];

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute(
  {
    swSrc: "src/service-worker/sw.ts",
    // esbuild nativo (dependência de desenvolvimento) em vez do esbuild-wasm, também na Vercel
    useNativeEsbuild: true,
    esbuildOptions: { sourcemap: false },
    // Padrão do Serwist mais as fontes (next/font guarda os .woff2 em _next/static/media)
    globPatterns: [
      ".next/static/**/*.{js,css,html,ico,png,svg,webp,json,webmanifest,woff,woff2}",
      "public/**/*",
    ],
    manifestTransforms: [
      async (entries) => {
        const revision =
          process.env.VERCEL_GIT_COMMIT_SHA ||
          createHash("sha256")
            .update(entries.map((entry) => `${entry.url} ${entry.revision ?? ""}`).join("\n"))
            .digest("hex");
        const pages = OFFLINE_PAGES.map((url) => ({ url, revision, size: 0 }));
        return { manifest: [...entries, ...pages], warnings: [] };
      },
    ],
  },
);
