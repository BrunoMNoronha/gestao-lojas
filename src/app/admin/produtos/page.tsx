import { getProducts } from "@/actions/products";
import { getCategories } from "@/actions/categories";
import { ProductsManager } from "@/components/products-manager";

export const metadata = {
  title: "Produtos e Categorias | Gestão de Lojas",
};

export default async function ProdutosPage() {
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
