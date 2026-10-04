"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
// Guarda o aviso de instalação do navegador desde o carregamento da página (issue #61)
import "@/lib/pwa-install";

// Provedores globais do cliente: tema (claro/escuro/sistema), tooltips e toasts
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delay={300}>
        {children}
        <Toaster position="top-right" closeButton />
      </TooltipProvider>
    </ThemeProvider>
  );
}
