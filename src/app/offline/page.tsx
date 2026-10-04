import { WifiOff } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { ReloadButton } from "@/components/offline-pdv/reload-button";

export const metadata = {
  title: "Sem conexão",
};

// Página estática guardada pelo Service Worker (issue #37): aparece no lugar de qualquer página do
// painel aberta sem conexão com o servidor. O PDV preparado continua disponível em /pdv.
export default function OfflinePage() {
  return (
    <div className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
      <EmptyState
        headingLevel="h1"
        icon={WifiOff}
        tone="primary"
        title="Sem conexão com o servidor"
        description="Esta página precisa de internet. Se o aparelho foi preparado, a Frente de Caixa continua disponível para consulta."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {/* Navegação completa: /pdv vem do cache do Service Worker */}
            <a href="/pdv" className={buttonVariants()}>
              Abrir PDV sem internet
            </a>
            <ReloadButton />
          </div>
        }
      />
    </div>
  );
}
