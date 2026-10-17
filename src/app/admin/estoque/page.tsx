import { getProductPage, getStockCounts } from "@/actions/browse";
import { pageNumber, type ListFilters } from "@/lib/pagination";
import { getSuppliers } from "@/actions/suppliers";
import { getStockMovements } from "@/actions/stock";
import { connection } from "next/server";
import { StockManager } from "@/components/stock-manager";
import { requirePageAccess } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { UnavailableState } from "@/components/empty-state";

export const metadata = {
  title: "Controle de Estoque",
};

export default async function EstoquePage({
  searchParams,
}: {
  searchParams: Promise<{ stock?: string; q?: string; page?: string }>;
}) {
  const query = await searchParams;
  // Saldos e movimentações mudam a cada venda: renderiza a cada requisição
  await connection();
  const user = await requirePageAccess("stock.view");

  let data: Awaited<ReturnType<typeof loadStockData>> | null = null;
  try {
    data = await loadStockData({ ...query, page: pageNumber(query.page) });
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
      products={data.products.items}
      pagination={{ page: data.products.page, total: data.products.total }}
      counts={data.counts}
      suppliers={data.suppliers}
      lowStock={data.products.items
        .filter((p) => p.currentStock <= p.minStock)
        .map((p) => ({
          ...p,
          categoryName: p.categoryName ?? null,
          deficit: Math.max(0, p.minStock - p.currentStock),
        }))}
      initialMovements={data.movements}
      canManage={can(user.role, "stock.manage")}
      canSeeCost={can(user.role, "catalog.manage")}
      operationScope={`stock:${user.id}`}
    />
  );
}

// Cada consulta já possui fallback próprio (lista vazia)
async function loadStockData(filters: ListFilters) {
  const [products, suppliers, counts, movements] = await Promise.all([
    getProductPage(filters),
    getSuppliers(),
    getStockCounts(),
    getStockMovements(),
  ]);
  return { products, suppliers, counts, movements };
}
