"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

// Falha inesperada ao renderizar uma página do painel; a sidebar continua disponível
export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      fullPage
      headingLevel="h1"
      icon={TriangleAlert}
      tone="destructive"
      title="Algo deu errado"
      description={
        <>
          Não foi possível exibir esta página. Tente novamente; se o problema continuar, fale com o
          administrador.
          {error.digest && (
            <span className="mt-2 block font-mono text-xs">Código: {error.digest}</span>
          )}
        </>
      }
      action={<Button onClick={() => retry()}>Tentar novamente</Button>}
    />
  );
}
