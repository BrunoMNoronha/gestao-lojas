import { getProducts } from "@/actions/products";
import { getSuppliers } from "@/actions/suppliers";
import { getLowStockProducts, getStockMovements } from "@/actions/stock";
import { connection } from "next/server";
import { StockManager } from "@/components/stock-manager";
import { requirePageAccess } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { UnavailableState } from "@/components/empty-state";

export const metadata = {
  title: "Controle de Estoque",
};

export default async function EstoquePage() {
  // Saldos e movimentações mudam a cada venda: renderiza a cada requisição
  await connection();
  const user = await requirePageAccess("stock.view");

  let data: Awaited<ReturnType<typeof loadStockData>> | null = null;
  try {
    data = await loadStockData();
  } catch (error) {
    console.error("Erro ao carregar o estoque:", error);
  }

  if (!data) {
    return (
      <UnavailableState
        title="Estoque indisponível"
        description="Não foi possível carregar os dados de estoque. Verifique a conexão com o banco de dados e recarregue a página."
      />
    );
  }

  return (
    <StockManager
      products={data.products}
      suppliers={data.suppliers}
      lowStock={data.lowStock}
      initialMovements={data.movements}
      canManage={can(user.role, "stock.manage")}
    />
  );
}

// Cada consulta já possui fallback próprio (lista vazia)
async function loadStockData() {
  const [products, suppliers, lowStock, movements] = await Promise.all([
    getProducts(),
    getSuppliers(),
    getLowStockProducts(),
    getStockMovements(),
  ]);
  return { products, suppliers, lowStock, movements };
}
