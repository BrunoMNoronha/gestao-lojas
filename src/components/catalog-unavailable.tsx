import { DatabaseZap, Store } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

// Catálogo desligado nas configurações ou banco fora do ar
export function CatalogUnavailable({ reason }: { reason: "disabled" | "error" }) {
  return (
    <EmptyState
      fullPage
      headingLevel="h1"
      icon={reason === "disabled" ? Store : DatabaseZap}
      tone={reason === "disabled" ? "muted" : "destructive"}
      title="Catálogo indisponível"
      description={
        reason === "disabled"
          ? "O catálogo desta loja não está disponível no momento. Entre em contato com a loja."
          : "Não foi possível carregar o catálogo agora. Tente novamente em instantes."
      }
    />
  );
}
