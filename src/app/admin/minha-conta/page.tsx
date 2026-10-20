import { connection } from "next/server";
import { DatabaseZap, UserRound } from "lucide-react";
import { getMyAccount } from "@/actions/users";
import { requirePageAccess } from "@/lib/authz";
import { ROLE_LABELS } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "@/components/change-password-form";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = {
  title: "Minha conta",
};

export default async function MinhaContaPage() {
  await connection();
  await requirePageAccess("account.self");

  const account = await getMyAccount();

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Minha conta"
        icon={UserRound}
        description="Seus dados de acesso e troca de senha."
      />

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
        <EmptyState
          icon={DatabaseZap}
          tone="destructive"
          title="Dados indisponíveis"
          description="Não foi possível carregar os dados da conta. Recarregue a página."
        />
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
