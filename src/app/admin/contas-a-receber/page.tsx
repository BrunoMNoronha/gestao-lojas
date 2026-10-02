import { getCustomers } from "@/actions/customers";
import { getReceivables, getReceivablesSummary } from "@/actions/receivables";
import { getCurrentCashRegister } from "@/actions/cash-register";
import { connection } from "next/server";
import { ReceivablesManager } from "@/components/receivables-manager";
import { requirePageAccess } from "@/lib/authz";
import { UnavailableState } from "@/components/empty-state";

export const metadata = {
  title: "Contas a Receber",
};

export default async function ContasAReceberPage() {
  // Títulos mudam a cada venda no Fiado e a cada recebimento: renderiza a cada requisição
  await connection();
  await requirePageAccess("receivables.view");

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

  return (
    <ReceivablesManager
      customers={data.customers}
      summary={data.summary}
      initialReceivables={data.receivables}
      hasOpenCashRegister={data.hasOpenCashRegister}
    />
  );
}

async function loadReceivablesData() {
  const [customers, summary, receivables, current] = await Promise.all([
    getCustomers(),
    getReceivablesSummary(),
    getReceivables(),
    getCurrentCashRegister(),
  ]);
  return { customers, summary, receivables, hasOpenCashRegister: !!current };
}
