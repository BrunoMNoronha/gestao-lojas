import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

// Servido em /robots.txt. Só a landing e o catálogo público vão para os buscadores; painel, PDV,
// login e etapas do pedido ficam de fora (essas páginas também levam noindex no próprio HTML).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/catalogo"],
      disallow: [
        "/admin",
        "/pdv",
        "/inicio",
        "/login",
        "/api",
        "/offline",
        "/serwist",
        "/catalogo/carrinho",
        "/catalogo/pedido",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
