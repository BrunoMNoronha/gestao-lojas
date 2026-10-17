import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { auth } from "@/auth";
import { FeatureShowcase } from "@/components/landing/feature-showcase";
import { FaqSection } from "@/components/landing/faq";
import { Hero } from "@/components/landing/hero";
import { MobileSection } from "@/components/landing/mobile-section";
import { OfflineSection } from "@/components/landing/offline-section";
import { MoreFeatures, RolesSection } from "@/components/landing/roles-section";
import { SCREENSHOTS } from "@/components/landing/screenshots";
import { FinalCta, SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";

const TITLE = "Gestão de Lojas — ERP e PDV para lojas físicas";
const DESCRIPTION =
  "Frente de caixa que vende mesmo sem internet, caixa, estoque, fiado, relatórios e catálogo online com pedido pelo WhatsApp. Para mercados, agropecuárias, distribuidores e lojas físicas.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    locale: "pt_BR",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: SCREENSHOTS.dashboard.src.src, alt: SCREENSHOTS.dashboard.alt }],
  },
};

// Landing pública de apresentação (todos a veem; o proxy libera "/"). A página inicial por perfil
// fica em /inicio. Só o cookie da sessão é lido (sem banco): se falhar, a página sai como visitante.
export default async function LandingPage() {
  let loggedIn = false;
  try {
    loggedIn = !!(await auth())?.user;
  } catch (error) {
    // Sinais internos do Next (ex.: renderização dinâmica no build) seguem adiante
    unstable_rethrow(error);
    console.error("Erro ao ler a sessão na página inicial:", error);
  }

  return (
    <>
      <a
        href="#conteudo"
        className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-4 py-2 font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Pular para o conteúdo
      </a>
      <SiteHeader loggedIn={loggedIn} />
      <main id="conteudo" tabIndex={-1} className="flex-1 outline-none">
        <Hero loggedIn={loggedIn} />
        <FeatureShowcase />
        <OfflineSection />
        <MobileSection />
        <RolesSection />
        <MoreFeatures />
        <FaqSection />
        <FinalCta loggedIn={loggedIn} />
      </main>
      <SiteFooter />
    </>
  );
}
