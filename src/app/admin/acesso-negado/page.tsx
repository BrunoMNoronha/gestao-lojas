import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { getSessionUser } from "@/lib/authz";
import { ROLE_LABELS, homePathFor } from "@/lib/permissions";

export const metadata = {
  title: "Acesso negado",
};

export default async function AcessoNegadoPage() {
  const user = await getSessionUser();

  return (
    <EmptyState
      fullPage
      headingLevel="h1"
      icon={ShieldAlert}
      tone="destructive"
      title="Acesso negado"
      description={
        <>
          {user
            ? `Seu perfil (${ROLE_LABELS[user.role]}) não tem permissão para acessar esta área.`
            : "Você não tem permissão para acessar esta área."}{" "}
          Fale com o administrador da loja se precisar de acesso.
        </>
      }
      action={
        <Link href={homePathFor(user?.role)} className={buttonVariants()}>
          Voltar à página inicial
        </Link>
      }
    />
  );
}
