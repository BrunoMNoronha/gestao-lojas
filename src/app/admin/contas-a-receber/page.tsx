import { getCustomerOptions } from "@/actions/browse";
import { getReceivables, getReceivablesSummary } from "@/actions/receivables";
import { getOpenCashRegister } from "@/actions/cash-register";
import { connection } from "next/server";
import Link from "next/link";
import { HandCoins, Settings } from "lucide-react";
import { ReceivablesManager } from "@/components/receivables-manager";
import { requirePageAccess } from "@/lib/authz";
import { EmptyState, UnavailableState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { getOnAccountSettings } from "@/lib/on-account";
import { can } from "@/lib/permissions";

export const metadata = {
  title: "Contas a Receber",
};

export default async function ContasAReceberPage() {
  // Títulos mudam a cada venda no Fiado e a cada recebimento: renderiza a cada requisição
  await connection();
  const user = await requirePageAccess("receivables.view");

  let data: Awaited<ReturnType<typeof loadReceivablesData>> | null = null;
  try {
    data = await loadReceivablesData();
  } catch (error) {
    console.error("Erro ao carregar contas a receber:", error);
  }

  if (!data) {
    return (
      <UnavailableState
        title="Contas a Receber indisponível"
        description="Não foi possível carregar os títulos. Verifique a conexão com o banco de dados e recarregue a página."
      />
    );
  }

  // Fiado desligado e nada a receber: o menu esconde a página, e o acesso direto pela URL
  // mostra um estado informativo
  if (!data.onAccountEnabled && data.summary.openCount === 0) {
    return (
      <EmptyState
        fullPage
        headingLevel="h1"
        icon={HandCoins}
        title="Venda no Fiado desativada"
        description="Não há títulos em aberto para receber. Para voltar a vender no Fiado, ative a opção nas Configurações da Loja."
        action={
          can(user.role, "settings.manage") && (
            <Link href="/admin/configuracoes" className={buttonVariants({ variant: "outline" })}>
              <Settings />
              Configurações da Loja
            </Link>
          )
        }
      />
    );
  }

  return (
    <ReceivablesManager
      onAccountEnabled={data.onAccountEnabled}
      customers={data.customers}
      summary={data.summary}
      initialReceivables={data.receivables}
      hasOpenCashRegister={data.hasOpenCashRegister}
    />
  );
}

async function loadReceivablesData() {
  const [customers, summary, receivables, current, onAccount] = await Promise.all([
    getCustomerOptions(),
    getReceivablesSummary(),
    getReceivables(),
    getOpenCashRegister(),
    getOnAccountSettings(),
  ]);
  return {
    customers,
    summary,
    receivables,
    hasOpenCashRegister: !!current,
    onAccountEnabled: onAccount.enabled,
  };
}
