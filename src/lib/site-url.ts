// Endereço público do sistema, usado como metadataBase (URLs absolutas de og:image) e no
// robots.txt/sitemap.xml. Ordem: SITE_URL explícito → domínio de produção da Vercel (definido
// automaticamente em todos os deploys) → localhost no desenvolvimento.
function resolveSiteUrl(): string {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export const SITE_URL = resolveSiteUrl();

// Áreas privadas (painel, PDV, login): fora dos buscadores, além do Disallow do robots.txt
export const NO_INDEX = { index: false, follow: false } as const;
