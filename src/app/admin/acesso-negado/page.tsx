import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/authz";
import { ROLE_LABELS, homePathFor } from "@/lib/permissions";

export const metadata = {
  title: "Acesso negado",
};

export default async function AcessoNegadoPage() {
  const user = await getSessionUser();

  return (
    <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
      <div className="bg-card max-w-md rounded-lg border p-6 text-center">
        <ShieldAlert className="text-destructive mx-auto mb-3 h-10 w-10" />
        <h1 className="text-lg font-semibold">Acesso negado</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {user
            ? `Seu perfil (${ROLE_LABELS[user.role]}) não tem permissão para acessar esta área.`
            : "Você não tem permissão para acessar esta área."}{" "}
          Fale com o administrador da loja se precisar de acesso.
        </p>
        <Link href={homePathFor(user?.role)}>
          <Button className="mt-4">Voltar à página inicial</Button>
        </Link>
      </div>
    </div>
  );
}
