import Link from "next/link";
import { Store } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

export const metadata = {
  title: "Página não encontrada",
};

export default function NotFound() {
  return (
    <div className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
      <EmptyState
        headingLevel="h1"
        icon={Store}
        tone="primary"
        title="Página não encontrada"
        description="O endereço acessado não existe ou foi movido."
        action={
          <Link href="/" className={buttonVariants()}>
            Ir para a página inicial
          </Link>
        }
      />
    </div>
  );
}
