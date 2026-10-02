"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Package,
  Plus,
  FolderKanban,
  Search,
  Edit2,
  Trash2,
  AlertTriangle,
  Boxes,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { ProductItem, deleteProduct } from "@/actions/products";
import { CategoryData } from "@/actions/categories";
import { ProductDialog } from "@/components/product-dialog";
import { CategoryDialog } from "@/components/category-dialog";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { isStockLow } from "@/lib/stock";

interface ProductsManagerProps {
  initialProducts: ProductItem[];
  initialCategories: CategoryData[];
}

export function ProductsManager({
  initialProducts,
  initialCategories,
}: ProductsManagerProps) {
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("ALL");

  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [productToEdit, setProductToEdit] = useState<ProductItem | null>(null);

  const filteredProducts = initialProducts.filter((p) => {
    const matchesSearch =
      !searchQuery.trim() ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.barcode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory =
      selectedCategory === "ALL" || p.categoryId === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  const handleOpenNewProduct = () => {
    setProductToEdit(null);
    setProductDialogOpen(true);
  };

  const handleOpenEditProduct = (product: ProductItem) => {
    setProductToEdit(product);
    setProductDialogOpen(true);
  };

  const handleDeleteProduct = async (id: string, name: string) => {
    if (!confirm(`Deseja realmente excluir o produto "${name}"?`)) return;

    const res = await deleteProduct(id);
    if (res.success) {
      router.refresh();
    } else {
      alert(res.error || "Erro ao excluir produto.");
    }
  };

  const handleRefreshData = () => {
    router.refresh();
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" />
            Produtos e Categorias
          </h1>
          <p className="text-sm text-muted-foreground">
            Gerencie o catálogo de produtos, preços, estoque e categorias da sua loja.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setCategoryDialogOpen(true)}
            className="flex items-center gap-1.5"
          >
            <FolderKanban className="w-4 h-4" />
            Categorias
          </Button>

          <Button
            onClick={handleOpenNewProduct}
            className="flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Novo Produto
          </Button>
        </div>
      </div>

      {/* Filters & Search */}
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, código de barras ou SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="w-full sm:w-64">
            <select
              className="w-full h-8 px-2.5 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="ALL">Todas as Categorias</option>
              {initialCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name} ({cat._count?.products ?? 0})
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card>
        <CardContent className="p-0">
          {filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <Boxes className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <h3 className="font-semibold text-base">Nenhum produto encontrado</h3>
              <p className="text-sm text-muted-foreground max-w-sm mt-1">
                {searchQuery || selectedCategory !== "ALL"
                  ? "Tente ajustar os filtros de busca para encontrar o produto desejado."
                  : "Cadastre seu primeiro produto para começar a gerenciar o estoque."}
              </p>
              {!searchQuery && selectedCategory === "ALL" && (
                <Button onClick={handleOpenNewProduct} className="mt-4">
                  <Plus className="w-4 h-4 mr-1.5" /> Cadastrar Produto
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Código / SKU</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">P. Custo</TableHead>
                  <TableHead className="text-right">P. Venda</TableHead>
                  <TableHead className="text-center">Un.</TableHead>
                  <TableHead className="text-right">Estoque</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((p) => {
                  const lowStock = isStockLow(p);

                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">
                        <div>
                          <span>{p.name}</span>
                        </div>
                      </TableCell>

                      <TableCell className="text-muted-foreground text-xs font-mono">
                        {p.barcode ? (
                          <div>EAN: {p.barcode}</div>
                        ) : p.sku ? (
                          <div>SKU: {p.sku}</div>
                        ) : (
                          "-"
                        )}
                      </TableCell>

                      <TableCell>
                        {p.categoryName ? (
                          <Badge variant="secondary" className="font-normal text-xs">
                            {p.categoryName}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>

                      <TableCell className="text-right text-muted-foreground">
                        {formatCurrency(p.costPrice)}
                      </TableCell>

                      <TableCell className="text-right font-semibold">
                        {formatCurrency(p.salePrice)}
                      </TableCell>

                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-xs">
                          {p.unit}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-right font-mono">
                        {formatNumber(p.currentStock)}
                      </TableCell>

                      <TableCell className="text-center">
                        {lowStock ? (
                          <Badge variant="destructive" className="text-[11px] gap-1">
                            <AlertTriangle className="w-3 h-3" /> Estoque Baixo
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[11px] text-emerald-600 border-emerald-600/30 bg-emerald-50/50 dark:bg-emerald-950/20 dark:text-emerald-400"
                          >
                            OK
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => handleOpenEditProduct(p)}
                            title="Editar produto"
                          >
                            <Edit2 className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => handleDeleteProduct(p.id, p.name)}
                            title="Excluir produto"
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Modals */}
      <ProductDialog
        open={productDialogOpen}
        onOpenChange={setProductDialogOpen}
        productToEdit={productToEdit}
        categories={initialCategories}
        onSuccess={handleRefreshData}
      />

      <CategoryDialog
        open={categoryDialogOpen}
        onOpenChange={setCategoryDialogOpen}
        categories={initialCategories}
        onCategoryChange={handleRefreshData}
      />
    </div>
  );
}
