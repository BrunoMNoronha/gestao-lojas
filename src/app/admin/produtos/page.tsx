import { getProducts } from "@/actions/products";
import { getCategories } from "@/actions/categories";
import { ProductsManager } from "@/components/products-manager";
import { connection } from "next/server";
import { requirePageAccess } from "@/lib/authz";
import { can } from "@/lib/permissions";

export const metadata = {
  title: "Produtos e Categorias",
};

export default async function ProdutosPage() {
  // Produtos e categorias vêm do banco: renderiza a cada requisição em vez de prerenderizar no build
  await connection();
  const user = await requirePageAccess("catalog.view");

  const [products, categories] = await Promise.all([
    getProducts(),
    getCategories(),
  ]);

  return (
    <ProductsManager
      initialProducts={products}
      initialCategories={categories}
      canManage={can(user.role, "catalog.manage")}
    />
  );
}
