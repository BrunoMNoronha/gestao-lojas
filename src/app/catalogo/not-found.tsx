import Link from "next/link";
import { PackageX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

export default function CatalogNotFound() {
  return (
    <EmptyState
      fullPage
      headingLevel="h1"
      icon={PackageX}
      title="Produto não encontrado"
      description="Este produto não existe ou não está mais no catálogo."
      action={
        <Link href="/catalogo" className={buttonVariants()}>
          Voltar ao catálogo
        </Link>
      }
    />
  );
}
