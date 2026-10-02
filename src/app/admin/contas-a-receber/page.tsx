import { getCustomers } from "@/actions/customers";
import { getReceivables, getReceivablesSummary } from "@/actions/receivables";
import { getCurrentCashRegister } from "@/actions/cash-register";
import { connection } from "next/server";
import { ReceivablesManager } from "@/components/receivables-manager";

export const metadata = {
  title: "Contas a Receber | Gestão de Lojas",
};

export default async function ContasAReceberPage() {
  // Títulos mudam a cada venda no Fiado e a cada recebimento: renderiza a cada requisição
  await connection();

  let data: Awaited<ReturnType<typeof loadReceivablesData>> | null = null;
  try {
    data = await loadReceivablesData();
  } catch (error) {
    console.error("Erro ao carregar contas a receber:", error);
  }

  if (!data) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="bg-card max-w-md rounded-lg border p-6 text-center">
          <h2 className="text-lg font-semibold">Contas a Receber indisponível</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Não foi possível carregar os títulos. Verifique a conexão com o banco de dados e
            recarregue a página.
          </p>
        </div>
      </div>
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
