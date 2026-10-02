import {
  getCashOperators,
  getCashRegisterHistory,
  getCurrentCashRegister,
} from "@/actions/cash-register";
import { connection } from "next/server";
import { CashRegisterManager } from "@/components/cash-register-manager";

export const metadata = {
  title: "Caixa | Gestão de Lojas",
};

export default async function CaixaPage() {
  // Saldo do turno muda a cada venda: renderiza a cada requisição
  await connection();

  let data: Awaited<ReturnType<typeof loadCashData>> | null = null;
  try {
    data = await loadCashData();
  } catch (error) {
    console.error("Erro ao carregar o caixa:", error);
  }

  if (!data) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="bg-card max-w-md rounded-lg border p-6 text-center">
          <h2 className="text-lg font-semibold">Caixa indisponível</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Não foi possível carregar os dados do caixa. Verifique a conexão com o banco de dados e
            recarregue a página.
          </p>
        </div>
      </div>
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
