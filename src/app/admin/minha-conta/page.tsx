import { connection } from "next/server";
import { UserRound } from "lucide-react";
import { getMyAccount } from "@/actions/users";
import { requirePageAccess } from "@/lib/authz";
import { ROLE_LABELS } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "@/components/change-password-form";

export const metadata = {
  title: "Minha conta",
};

export default async function MinhaContaPage() {
  await connection();
  await requirePageAccess("account.self");

  const account = await getMyAccount();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <UserRound className="text-primary h-6 w-6" />
          Minha conta
        </h1>
        <p className="text-muted-foreground text-sm">Seus dados de acesso e troca de senha.</p>
      </div>

      {account ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dados do usuário</CardTitle>
            <CardDescription>
              Para alterar nome, e-mail ou perfil, fale com o administrador da loja.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Nome</dt>
              <dd className="font-medium">{account.name}</dd>
              <dt className="text-muted-foreground">E-mail</dt>
              <dd>{account.email}</dd>
              <dt className="text-muted-foreground">Perfil</dt>
              <dd>{ROLE_LABELS[account.role]}</dd>
            </dl>
          </CardContent>
        </Card>
      ) : (
        <div className="bg-card rounded-lg border p-6 text-center text-sm">
          Não foi possível carregar os dados da conta. Recarregue a página.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trocar senha</CardTitle>
          <CardDescription>
            Informe a senha atual e a nova senha (mínimo 8 caracteres).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
