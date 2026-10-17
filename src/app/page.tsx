import type { Metadata } from "next";
import { FeatureShowcase } from "@/components/landing/feature-showcase";
import { FaqSection } from "@/components/landing/faq";
import { Hero } from "@/components/landing/hero";
import { MobileSection } from "@/components/landing/mobile-section";
import { OfflineSection } from "@/components/landing/offline-section";
import { MoreFeatures, RolesSection } from "@/components/landing/roles-section";
import { SCREENSHOTS } from "@/components/landing/screenshots";
import { FinalCta, SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { VideoSection } from "@/components/landing/video-section";
import { WhatsAppButton } from "@/components/landing/whatsapp-button";

const TITLE = "Gestão de Lojas — ERP e PDV para lojas físicas";
const DESCRIPTION =
  "Frente de caixa que vende mesmo sem internet, caixa, estoque, fiado, relatórios e catálogo online com pedido pelo WhatsApp. Para mercados, agropecuárias, distribuidores e lojas físicas.";

// URL relativa da captura; o metadataBase do layout raiz a torna absoluta em og:image/twitter:image
const SHARE_IMAGE = { url: SCREENSHOTS.dashboard.src.src, alt: SCREENSHOTS.dashboard.alt };

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Gestão de Lojas",
    url: "/",
    title: TITLE,
    description: DESCRIPTION,
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [SHARE_IMAGE],
  },
};

// Landing pública de apresentação, estática: gerada no build e servida da CDN, sem sessão nem
// banco (o proxy nem roda em "/", src/proxy.ts). A página inicial por perfil fica em /inicio.
export const dynamic = "force-static";

export default function LandingPage() {
  return (
    <>
      <a
        href="#conteudo"
        className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-4 py-2 font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Pular para o conteúdo
      </a>
      <SiteHeader />
      <main id="conteudo" tabIndex={-1} className="flex-1 outline-none">
        <Hero />
        <VideoSection />
        <FeatureShowcase />
        <OfflineSection />
        <MobileSection />
        <RolesSection />
        <MoreFeatures />
        <FaqSection />
        <FinalCta />
      </main>
      <SiteFooter />
      <WhatsAppButton />
    </>
  );
}
