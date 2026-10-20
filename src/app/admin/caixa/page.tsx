import {
  getCashOperators,
  getCashRegisterHistory,
  getCurrentCashRegister,
} from "@/actions/cash-register";
import { connection } from "next/server";
import { CashRegisterManager } from "@/components/cash-register-manager";
import { requirePageAccess } from "@/lib/authz";
import { UnavailableState } from "@/components/empty-state";

export const metadata = {
  title: "Caixa",
};

export default async function CaixaPage() {
  // Saldo do turno muda a cada venda: renderiza a cada requisição
  await connection();
  await requirePageAccess("cash.own");

  let data: Awaited<ReturnType<typeof loadCashData>> | null = null;
  try {
    data = await loadCashData();
  } catch (error) {
    console.error("Erro ao carregar o caixa:", error);
  }

  if (!data) {
    return (
      <UnavailableState
        title="Caixa indisponível"
        description="Não foi possível carregar os dados do caixa. Verifique a conexão com o banco de dados e recarregue a página."
      />
    );
  }

  return (
    <CashRegisterManager
      current={data.current}
      operators={data.operators}
      initialHistory={data.history}
    />
  );
}

// getCurrentCashRegister propaga falhas do banco para cair no fallback acima
async function loadCashData() {
  const [current, operators, history] = await Promise.all([
    getCurrentCashRegister(),
    getCashOperators(),
    getCashRegisterHistory(),
  ]);
  return { current, operators, history };
}
