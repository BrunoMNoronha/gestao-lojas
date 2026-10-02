import { getProducts } from "@/actions/products";
import { getSuppliers } from "@/actions/suppliers";
import { getLowStockProducts, getStockMovements } from "@/actions/stock";
import { connection } from "next/server";
import { StockManager } from "@/components/stock-manager";

export const metadata = {
  title: "Controle de Estoque | Gestão de Lojas",
};

export default async function EstoquePage() {
  // Saldos e movimentações mudam a cada venda: renderiza a cada requisição
  await connection();

  let data: Awaited<ReturnType<typeof loadStockData>> | null = null;
  try {
    data = await loadStockData();
  } catch (error) {
    console.error("Erro ao carregar o estoque:", error);
  }

  if (!data) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="bg-card max-w-md rounded-lg border p-6 text-center">
          <h2 className="text-lg font-semibold">Estoque indisponível</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Não foi possível carregar os dados de estoque. Verifique a conexão com o banco de dados
            e recarregue a página.
          </p>
        </div>
      </div>
    );
  }

  return (
    <StockManager
      products={data.products}
      suppliers={data.suppliers}
      lowStock={data.lowStock}
      initialMovements={data.movements}
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
