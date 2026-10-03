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
  Store,
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
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { IconButton } from "@/components/icon-button";
import { OptionSelect } from "@/components/option-select";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { isStockLow } from "@/lib/stock";
import { ScanBarcodeButton } from "@/components/barcode-scanner-dialog";

interface ProductsManagerProps {
  initialProducts: ProductItem[];
  initialCategories: CategoryData[];
  // Cadastro, edição e exclusão restritos por perfil (catalog.manage)
  canManage: boolean;
}

export function ProductsManager({
  initialProducts,
  initialCategories,
  canManage,
}: ProductsManagerProps) {
  const router = useRouter();
  const [askConfirm, confirmDialog] = useConfirm();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  // Filtro do catálogo público: todos, só os exibidos ou só os ocultos
  const [catalogFilter, setCatalogFilter] = useState("ALL");

  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [productToEdit, setProductToEdit] = useState<ProductItem | null>(null);
  const [newProductBarcode, setNewProductBarcode] = useState<string | undefined>();

  const filteredProducts = initialProducts.filter((p) => {
    const matchesSearch =
      !searchQuery.trim() ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.barcode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = selectedCategory === "ALL" || p.categoryId === selectedCategory;

    const matchesCatalog = catalogFilter === "ALL" || (catalogFilter === "IN") === p.showInCatalog;

    return matchesSearch && matchesCategory && matchesCatalog;
  });

  const handleOpenNewProduct = (barcode?: string) => {
    setProductToEdit(null);
    setNewProductBarcode(barcode);
    setProductDialogOpen(true);
  };

  // Consulta pela câmera: filtra a lista pelo código; sem produto, oferece o cadastro (catalog.manage)
  const handleScannedCode = (code: string) => {
    setSearchQuery(code);
    setSelectedCategory("ALL");
    setCatalogFilter("ALL");
    const q = code.toLowerCase();
    const found = initialProducts.some(
      (p) => p.barcode?.toLowerCase() === q || p.sku?.toLowerCase() === q,
    );
    if (found) {
      toast.success(`Produto encontrado para o código ${code}.`);
    } else if (canManage) {
      toast.error(`Nenhum produto com o código ${code}.`, {
        action: { label: "Cadastrar", onClick: () => handleOpenNewProduct(code) },
      });
    } else {
      toast.error(`Nenhum produto com o código ${code}.`);
    }
  };

  const handleOpenEditProduct = (product: ProductItem) => {
    setNewProductBarcode(undefined);
    setProductToEdit(product);
    setProductDialogOpen(true);
  };

  const handleDeleteProduct = async (id: string, name: string) => {
    const confirmed = await askConfirm({
      title: "Excluir produto?",
      description: `O produto "${name}" sairá do cadastro, do PDV e do catálogo. O histórico de vendas e de estoque é mantido. Esta ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!confirmed) return;

    const res = await deleteProduct(id);
    if (res.success) {
      toast.success("Produto excluído.");
      router.refresh();
    } else {
      toast.error(res.error || "Erro ao excluir produto.");
    }
  };

  const handleRefreshData = () => {
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Produtos e Categorias"
        icon={Package}
        description="Gerencie o catálogo de produtos, preços, estoque e categorias da sua loja."
        actions={
          canManage && (
            <>
              <Button variant="outline" onClick={() => setCategoryDialogOpen(true)}>
                <FolderKanban />
                Categorias
              </Button>
              <Button onClick={() => handleOpenNewProduct()}>
                <Plus />
                Novo Produto
              </Button>
            </>
          )
        }
      />

      {/* Filters & Search */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
          <div className="flex flex-1 gap-2">
            <div className="relative flex-1">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                aria-label="Buscar produto"
                placeholder="Buscar por nome, código de barras ou SKU..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <ScanBarcodeButton
              size="icon-sm"
              className="size-8"
              label="Consultar código pela câmera"
              title="Consultar produto"
              description="Aponte a câmera para o código de barras para encontrar o produto."
              onDetected={handleScannedCode}
            />
          </div>

          <div className="w-full sm:w-48">
            <OptionSelect
              aria-label="Filtrar pelo catálogo público"
              value={catalogFilter}
              onValueChange={setCatalogFilter}
              options={[
                { value: "ALL", label: "Catálogo: todos" },
                { value: "IN", label: "No catálogo" },
                { value: "OUT", label: "Fora do catálogo" },
              ]}
            />
          </div>

          <div className="w-full sm:w-64">
            <OptionSelect
              aria-label="Filtrar por categoria"
              value={selectedCategory}
              onValueChange={setSelectedCategory}
              options={[
                { value: "ALL", label: "Todas as Categorias" },
                ...initialCategories.map((cat) => ({
                  value: cat.id,
                  label: `${cat.name} (${cat._count?.products ?? 0})`,
                })),
              ]}
            />
          </div>
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card>
        <CardContent className="p-0">
          {filteredProducts.length === 0 ? (
            <EmptyState
              className="border-0"
              icon={Boxes}
              title="Nenhum produto encontrado"
              description={
                searchQuery || selectedCategory !== "ALL" || catalogFilter !== "ALL"
                  ? "Tente ajustar os filtros de busca para encontrar o produto desejado."
                  : "Cadastre seu primeiro produto para começar a gerenciar o estoque."
              }
              action={
                canManage &&
                !searchQuery &&
                selectedCategory === "ALL" &&
                catalogFilter === "ALL" && (
                  <Button onClick={() => handleOpenNewProduct()}>
                    <Plus /> Cadastrar Produto
                  </Button>
                )
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="hidden lg:table-cell">Código / SKU</TableHead>
                  <TableHead className="hidden md:table-cell">Categoria</TableHead>
                  {canManage && (
                    <TableHead className="hidden text-right md:table-cell">P. Custo</TableHead>
                  )}
                  <TableHead className="text-right">P. Venda</TableHead>
                  <TableHead className="hidden text-center sm:table-cell">Un.</TableHead>
                  <TableHead className="text-right">Estoque</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  {canManage && <TableHead className="text-center">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((p) => {
                  const lowStock = isStockLow(p);

                  return (
                    <TableRow key={p.id}>
                      <TableCell className="min-w-40 font-medium whitespace-normal">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span>{p.name}</span>
                          {p.showInCatalog && (
                            <Badge variant="info" className="gap-1 text-[11px] font-normal">
                              <Store aria-hidden /> Catálogo
                            </Badge>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="text-muted-foreground hidden font-mono text-xs lg:table-cell">
                        {p.barcode ? (
                          <div>EAN: {p.barcode}</div>
                        ) : p.sku ? (
                          <div>SKU: {p.sku}</div>
                        ) : (
                          "-"
                        )}
                      </TableCell>

                      <TableCell className="hidden md:table-cell">
                        {p.categoryName ? (
                          <Badge variant="secondary" className="text-xs font-normal">
                            {p.categoryName}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>

                      {canManage && (
                        <TableCell className="text-muted-foreground hidden text-right md:table-cell">
                          {p.costPrice !== undefined ? formatCurrency(p.costPrice) : "-"}
                        </TableCell>
                      )}

                      <TableCell className="text-right font-semibold">
                        {formatCurrency(p.salePrice)}
                      </TableCell>

                      <TableCell className="hidden text-center sm:table-cell">
                        <Badge variant="outline" className="text-xs">
                          {p.unit}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-right font-mono">
                        {formatNumber(p.currentStock)}
                      </TableCell>

                      <TableCell className="text-center">
                        {lowStock ? (
                          <Badge variant="destructive" className="gap-1 text-[11px]">
                            <AlertTriangle className="h-3 w-3" /> Estoque Baixo
                          </Badge>
                        ) : (
                          <Badge variant="success" className="text-[11px]">
                            OK
                          </Badge>
                        )}
                      </TableCell>

                      {canManage && (
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <IconButton
                              label="Editar produto"
                              onClick={() => handleOpenEditProduct(p)}
                            >
                              <Edit2 className="text-muted-foreground" />
                            </IconButton>
                            <IconButton
                              label="Excluir produto"
                              onClick={() => handleDeleteProduct(p.id, p.name)}
                            >
                              <Trash2 className="text-destructive" />
                            </IconButton>
                          </div>
                        </TableCell>
                      )}
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
        initialBarcode={newProductBarcode}
        categories={initialCategories}
        onSuccess={handleRefreshData}
      />

      <CategoryDialog
        open={categoryDialogOpen}
        onOpenChange={setCategoryDialogOpen}
        categories={initialCategories}
        onCategoryChange={handleRefreshData}
      />
      {confirmDialog}
    </div>
  );
}
