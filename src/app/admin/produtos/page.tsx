import { getProducts } from "@/actions/products";
import { getCategories } from "@/actions/categories";
import { ProductsManager } from "@/components/products-manager";
import { connection } from "next/server";

export const metadata = {
  title: "Produtos e Categorias | Gestão de Lojas",
};

export default async function ProdutosPage() {
  // Produtos e categorias vêm do banco: renderiza a cada requisição em vez de prerenderizar no build
  await connection();

  const [products, categories] = await Promise.all([
    getProducts(),
    getCategories(),
  ]);

  return (
    <ProductsManager
      initialProducts={products}
      initialCategories={categories}
    />
  );
}
