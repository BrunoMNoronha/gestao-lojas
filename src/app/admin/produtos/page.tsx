import { getProductPage } from "@/actions/browse";
import { pageNumber } from "@/lib/pagination";
import { getCategories } from "@/actions/categories";
import { ProductsManager } from "@/components/products-manager";
import { connection } from "next/server";
import { requirePageAccess } from "@/lib/authz";
import { can } from "@/lib/permissions";

export const metadata = {
  title: "Produtos e Categorias",
};

export default async function ProdutosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; category?: string; catalog?: string }>;
}) {
  const query = await searchParams;
  // Produtos e categorias vêm do banco: renderiza a cada requisição em vez de prerenderizar no build
  await connection();
  const user = await requirePageAccess("catalog.view");

  const [products, categories] = await Promise.all([
    getProductPage({ ...query, page: pageNumber(query.page) }),
    getCategories(),
  ]);

  return (
    <ProductsManager
      initialProducts={products.items}
      pagination={{ page: products.page, total: products.total }}
      initialCategories={categories}
      canManage={can(user.role, "catalog.manage")}
    />
  );
}
