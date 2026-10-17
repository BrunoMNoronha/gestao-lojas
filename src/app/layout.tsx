import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Providers } from "@/components/providers";
import { cn } from "@/lib/utils";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Gestão de Lojas",
    template: "%s | Gestão de Lojas",
  },
  description: "Sistema de gestão comercial e frente de caixa (PDV) para lojas físicas.",
  applicationName: "Gestão Lojas",
  // favicon.ico e icon.svg entram pela convenção de arquivos de src/app (gerados por `pnpm icons`).
  // Instalação no iPhone/iPad (issue #61): ícone e nome na Tela de Início, abrindo em tela cheia.
  // O manifest (src/app/manifest.ts) cobre Chrome e Edge.
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Gestão Lojas", statusBarStyle: "default" },
};

// Cor da barra do navegador e da janela do app instalado: a mesma do manifest no tema claro e o
// fundo do tema escuro (--background de .dark em globals.css)
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#126a70" },
    { media: "(prefers-color-scheme: dark)", color: "#090e11" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: o next-themes aplica a classe do tema no <html> antes da hidratação
    <html
      lang="pt-BR"
      className={cn(geistSans.variable, geistMono.variable, "h-full antialiased")}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
