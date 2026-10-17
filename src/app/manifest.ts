import type { MetadataRoute } from "next";

// Manifest do app instalável (issue #37). Servido em /manifest.webmanifest e gerado no build.
// O atalho leva ao PDV que abre sem internet depois da preparação. O app instalado abre em /inicio
// (página inicial do perfil), não na landing pública de "/"; o `id` continua "/" para não mudar a
// identidade de quem já instalou.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gestão de Lojas",
    short_name: "Gestão Lojas",
    description: "Sistema de gestão comercial e frente de caixa (PDV) para lojas físicas.",
    id: "/",
    start_url: "/inicio",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#126a70",
    lang: "pt-BR",
    categories: ["business", "productivity"],
    // Ícones gerados por `pnpm icons` (scripts/generate-icons.mjs), a partir da mesma marca da interface
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Frente de Caixa (PDV)",
        short_name: "PDV",
        url: "/pdv",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
