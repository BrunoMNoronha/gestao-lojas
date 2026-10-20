"use client";

import { useState } from "react";
import { ListPagination, useListFilters } from "@/components/list-pagination";
import type { PageInfo } from "@/lib/pagination";
import {
  Package,
  Plus,
  FolderKanban,
  Search,
  Edit2,
  Trash2,
  AlertTriangle,
  Boxes,
  MoreVertical,
  SlidersHorizontal,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { getProductOptions } from "@/actions/browse";
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
import { formatQuantity, type CatalogUnit } from "@/lib/catalog-shared";
import { cn, formatCurrency } from "@/lib/utils";
import { isStockLow } from "@/lib/stock";
import { ScanBarcodeButton } from "@/components/barcode-scanner-dialog";

// Estoque com a unidade ("4 CX", "2,5 KG"); abaixo do mínimo, em destaque com aviso
function StockValue({ product }: { product: ProductItem }) {
  const low = isStockLow(product);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 tabular-nums",
        low && "text-destructive font-medium",
      )}
      title={low ? "Estoque baixo (no mínimo ou abaixo)" : undefined}
    >
      {low && <AlertTriangle className="size-3.5 shrink-0" aria-hidden />}
      {formatQuantity(product.unit as CatalogUnit, product.currentStock)} {product.unit}
      {low && <span className="sr-only">, estoque baixo</span>}
    </span>
  );
}

// Conteúdo do cartão do produto no celular
function ProductCardBody({ product: p }: { product: ProductItem }) {
  const low = isStockLow(p);
  return (
    <span className="block space-y-1">
      <span className="flex items-start justify-between gap-3">
        <span className="line-clamp-2 font-medium break-words">{p.name}</span>
        <span className="shrink-0 font-semibold tabular-nums">{formatCurrency(p.salePrice)}</span>
      </span>
      <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <StockValue product={p} />
        {p.categoryName && <span>· {p.categoryName}</span>}
        {p.containedProductId && p.unitsPerBox && <span>· Caixa com {p.unitsPerBox} un.</span>}
      </span>
      {(p.showInCatalog || low) && (
        <span className="flex flex-wrap gap-1.5 pt-0.5">
          {p.showInCatalog && (
            <Badge variant="info" className="gap-1 text-[11px] font-normal">
              <Store aria-hidden /> Catálogo
            </Badge>
          )}
          {low && (
            <Badge variant="destructive" className="gap-1 text-[11px]">
              <AlertTriangle aria-hidden /> Estoque baixo
            </Badge>
          )}
        </span>
      )}
    </span>
  );
}

interface ProductsManagerProps {
  initialProducts: ProductItem[];
  pagination: PageInfo;
  initialCategories: CategoryData[];
  // Cadastro, edição e exclusão restritos por perfil (catalog.manage)
  canManage: boolean;
  // Margem das configurações da loja que sugere o preço de venda de produto novo
  defaultProfitMargin: number | null;
}

export function ProductsManager({
  initialProducts,
  pagination,
  initialCategories,
  canManage,
  defaultProfitMargin,
}: ProductsManagerProps) {
  const [askConfirm, confirmDialog] = useConfirm();

  const [listFilters, setListFilters] = useListFilters({ q: "", category: "ALL", catalog: "ALL" });
  const searchQuery = listFilters.q;
  const selectedCategory = listFilters.category;
  const catalogFilter = listFilters.catalog;
  const setSearchQuery = (q: string) => setListFilters({ q });
  const setSelectedCategory = (category: string) => setListFilters({ category });
  const setCatalogFilter = (catalog: string) => setListFilters({ catalog });

  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [productToEdit, setProductToEdit] = useState<ProductItem | null>(null);
  const [newProductBarcode, setNewProductBarcode] = useState<string | undefined>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = (catalogFilter !== "ALL" ? 1 : 0) + (selectedCategory !== "ALL" ? 1 : 0);

  const filteredProducts = initialProducts;

  const handleOpenNewProduct = (barcode?: string) => {
    setProductToEdit(null);
    setNewProductBarcode(barcode);
    setProductDialogOpen(true);
  };

  // Consulta pela câmera: filtra a lista pelo código; sem produto, oferece o cadastro (catalog.manage)
  const handleScannedCode = async (code: string) => {
    setSearchQuery(code);
    setSelectedCategory("ALL");
    setCatalogFilter("ALL");
    const q = code.toLowerCase();
    const found = (await getProductOptions(code, undefined, undefined, true)).some(
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
    } else {
      toast.error(res.error || "Erro ao excluir produto.");
    }
  };

  const handleRefreshData = () => {};

  const catalogSelect = (
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
  );
  const categorySelect = (
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
  );

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

      {/* Busca e filtros: no celular, catálogo e categoria ficam no painel "Filtros" */}
      <div className="md:bg-card md:ring-foreground/10 flex flex-col gap-3 md:flex-row md:rounded-xl md:p-4 md:ring-1">
        <div className="flex flex-1 gap-2">
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              aria-label="Buscar produto"
              placeholder="Buscar por nome, EAN ou SKU"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-11 pl-9 md:h-8"
            />
          </div>
          <ScanBarcodeButton
            size="icon-sm"
            className="size-11 md:size-8"
            label="Consultar código pela câmera"
            title="Consultar produto"
            description="Aponte a câmera para o código de barras para encontrar o produto."
            onDetected={handleScannedCode}
          />
          <Button
            variant="outline"
            className="h-11 md:hidden"
            onClick={() => setFiltersOpen(true)}
            aria-label={activeFilters > 0 ? `Filtros, ${activeFilters} ativo(s)` : "Filtros"}
          >
            <SlidersHorizontal />
            {activeFilters > 0 ? `(${activeFilters})` : null}
          </Button>
        </div>

        <div className="hidden md:block md:w-48">{catalogSelect}</div>
        <div className="hidden md:block md:w-64">{categorySelect}</div>
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom" className="gap-4 p-4">
          <SheetTitle>Filtros</SheetTitle>
          <SheetDescription className="sr-only">
            Filtrar produtos por catálogo e categoria
          </SheetDescription>
          <div className="space-y-3">
            {catalogSelect}
            {categorySelect}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-11"
              disabled={activeFilters === 0}
              onClick={() => {
                setSelectedCategory("ALL");
                setCatalogFilter("ALL");
              }}
            >
              Limpar filtros
            </Button>
            <Button className="h-11" onClick={() => setFiltersOpen(false)}>
              Ver produtos
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Lista: cartões no celular, tabela a partir de md */}
      <Card className="max-md:py-1">
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
            <>
              <ul className="divide-y md:hidden">
                {filteredProducts.map((p) => {
                  const body = <ProductCardBody product={p} />;
                  return (
                    <li key={p.id} className="flex items-start gap-1 p-2">
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => handleOpenEditProduct(p)}
                          className="hover:bg-muted/50 focus-visible:ring-ring/50 min-h-11 min-w-0 flex-1 rounded-md p-2 text-left outline-none focus-visible:ring-3"
                        >
                          <span className="sr-only">Editar: </span>
                          {body}
                        </button>
                      ) : (
                        <div className="min-w-0 flex-1 p-2">{body}</div>
                      )}
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-11 shrink-0"
                                aria-label={`Mais ações para ${p.name}`}
                              />
                            }
                          >
                            <MoreVertical />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem onClick={() => handleOpenEditProduct(p)}>
                              <Edit2 /> Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => handleDeleteProduct(p.id, p.name)}
                            >
                              <Trash2 /> Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </li>
                  );
                })}
              </ul>

              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="hidden lg:table-cell">Código / SKU</TableHead>
                    <TableHead>Categoria</TableHead>
                    {canManage && <TableHead className="text-right">P. Custo</TableHead>}
                    <TableHead className="text-right">P. Venda</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    {canManage && <TableHead className="text-center">Ações</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map((p) => (
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
                        {p.containedProductId && (
                          <p className="text-muted-foreground mt-1 text-xs font-normal">
                            1 caixa gera {p.unitsPerBox} unidades de{" "}
                            {p.containedProductName ?? "produto avulso"}
                          </p>
                        )}
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

                      <TableCell>
                        {p.categoryName ? (
                          <Badge variant="secondary" className="text-xs font-normal">
                            {p.categoryName}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>

                      {canManage && (
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {p.costPrice !== undefined ? formatCurrency(p.costPrice) : "-"}
                        </TableCell>
                      )}

                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatCurrency(p.salePrice)}
                      </TableCell>

                      <TableCell className="text-right">
                        <StockValue product={p} />
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
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      <ListPagination {...pagination} />
      {/* Modals */}
      <ProductDialog
        open={productDialogOpen}
        onOpenChange={setProductDialogOpen}
        productToEdit={productToEdit}
        initialBarcode={newProductBarcode}
        categories={initialCategories}
        products={initialProducts}
        defaultProfitMargin={defaultProfitMargin}
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
