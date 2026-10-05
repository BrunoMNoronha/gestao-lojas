"use client";

import { useState, useRef } from "react";
import { ListPagination, useListFilters } from "@/components/list-pagination";
import { ProductLookup } from "@/components/async-lookup";
import type { PageInfo } from "@/lib/pagination";
import {
  Boxes,
  PackagePlus,
  ClipboardCheck,
  AlertTriangle,
  History,
  PackageX,
  Package,
  PackageOpen,
  Loader2,
  X,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductItem, refreshUnpackProducts } from "@/actions/products";
import { SupplierItem } from "@/actions/suppliers";
import {
  LowStockItem,
  MovementTypeValue,
  StockMovementItem,
  StockMovementPage,
  getStockMovements,
} from "@/actions/stock";
import { cn, formatCurrency } from "@/lib/utils";
import { MOVEMENT_TYPE_LABELS, formatQuantity } from "@/lib/stock";
import { StockEntryDialog } from "@/components/stock-entry-dialog";
import { StockAdjustDialog } from "@/components/stock-adjust-dialog";
import { StockUnpackDialog, usePendingStockUnpack } from "@/components/stock-unpack-dialog";
import { OptionSelect } from "@/components/option-select";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";

interface StockManagerProps {
  products: ProductItem[];
  pagination: PageInfo;
  counts: { total: number; low: number; zero: number; negative: number };
  suppliers: SupplierItem[];
  lowStock: LowStockItem[];
  initialMovements: StockMovementPage;
  // Entradas e ajustes restritos por perfil (stock.manage)
  canManage: boolean;
  // Coluna de custo unitário só para quem vê preço de custo (catalog.manage)
  canSeeCost: boolean;
  operationScope: string;
}

interface Filters {
  productId: string;
  type: "" | MovementTypeValue;
  from: string; // YYYY-MM-DD (dia local)
  to: string;
}

const PAGE_SIZE = 50;
const EMPTY_FILTERS: Filters = { productId: "", type: "", from: "", to: "" };

// Converte o dia local escolhido em limite ISO (início ou fim do dia no fuso do navegador)
function dayBoundary(value: string, endOfDay: boolean): string | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = endOfDay
    ? new Date(y, m - 1, d, 23, 59, 59, 999)
    : new Date(y, m - 1, d, 0, 0, 0, 0);
  return date.toISOString();
}

const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );

function signedQuantity(m: StockMovementItem) {
  const value = m.type === "OUT" ? -m.quantity : m.quantity;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatQuantity(Math.abs(value), m.unit)}`;
}

function MovementTypeBadge({ type }: { type: MovementTypeValue }) {
  const className = {
    IN: "text-success border-success/30 bg-success/10",
    OUT: "text-info border-info/30 bg-info/10",
    ADJUSTMENT: "text-warning border-warning/30 bg-warning/10",
  }[type];

  return (
    <Badge variant="outline" className={cn("text-[11px]", className)}>
      {MOVEMENT_TYPE_LABELS[type]}
    </Badge>
  );
}

export function StockManager({
  products: initialProducts,
  pagination,
  counts,
  suppliers,
  lowStock,
  initialMovements,
  canManage,
  canSeeCost,
  operationScope,
}: StockManagerProps) {
  const [listFilters, setListFilters] = useListFilters({ q: "", stock: "history" });
  const search = listFilters.q;
  const setSearch = (q: string) => setListFilters({ q });
  const [chosenFilter, setChosenFilter] = useState<ProductItem | null>(null);
  const [products, setProducts] = useState(initialProducts);
  const [syncedProducts, setSyncedProducts] = useState(initialProducts);
  if (syncedProducts !== initialProducts) {
    setSyncedProducts(initialProducts);
    setProducts(initialProducts);
  }
  const pendingUnpack = usePendingStockUnpack(operationScope);

  const view = listFilters.stock;
  const setView = (stock: string) => setListFilters({ stock });
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [movements, setMovements] = useState<StockMovementPage>(initialMovements);
  const [loadingMovements, setLoadingMovements] = useState(false);

  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [unpackProductId, setUnpackProductId] = useState<string | null>(null);
  const [dialogProductId, setDialogProductId] = useState<string | null>(null);
  // Trocar a key remonta o diálogo e reinicia o formulário a cada abertura
  const [dialogKey, setDialogKey] = useState(0);

  const [offset, setOffset] = useState(0);
  const requestVersion = useRef(0);
  const [syncedPage, setSyncedPage] = useState(initialMovements);
  if (syncedPage !== initialMovements) {
    setSyncedPage(initialMovements);
    if (!Object.values(filters).some(Boolean) && offset === 0) setMovements(initialMovements);
  }
  const outOfStockCount = counts.zero + counts.negative;
  // Saldo negativo só acontece pela sincronização de vendas offline (docs/OFFLINE.md seção 3.2)
  const negativeStock = products.filter((p) => p.currentStock < 0);
  const hasFilters = Object.values(filters).some(Boolean);
  const linkedBoxes = products.filter(
    (product) =>
      product.unit === "CX" &&
      product.containedProductId &&
      (product.unitsPerBox ?? 0) >= 2 &&
      !!product.containedProduct,
  );
  const unpackBox = products.find((product) => product.id === unpackProductId);
  const selectedRecovery =
    pendingUnpack?.input.boxProductId === unpackProductId ? pendingUnpack : null;
  const dialogBox = selectedRecovery
    ? {
        id: selectedRecovery.input.boxProductId,
        name: selectedRecovery.boxName,
        unit: "CX" as const,
        currentStock: unpackBox?.currentStock ?? 0,
        containedProductId: selectedRecovery.input.expectedUnitProductId,
        unitsPerBox: selectedRecovery.input.expectedUnitsPerBox,
      }
    : unpackBox;
  const unpackUnit =
    unpackBox?.containedProduct ??
    products.find((product) => product.id === dialogBox?.containedProductId);
  const dialogUnit = selectedRecovery
    ? {
        id: selectedRecovery.input.expectedUnitProductId,
        name: selectedRecovery.unitName,
        unit: "UN" as const,
        currentStock: unpackUnit?.currentStock ?? 0,
      }
    : unpackUnit;

  const loadMovements = async (nextFilters: Filters, nextOffset = 0) => {
    const version = ++requestVersion.current;
    setLoadingMovements(true);
    const page = await getStockMovements({
      productId: nextFilters.productId || null,
      type: nextFilters.type || null,
      from: dayBoundary(nextFilters.from, false),
      to: dayBoundary(nextFilters.to, true),
      take: PAGE_SIZE,
      skip: nextOffset,
    });
    if (version !== requestVersion.current) return;
    setMovements(page);
    setOffset(nextOffset);
    setLoadingMovements(false);
  };

  const updateFilters = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    loadMovements(next);
  };

  const clearFilters = () => {
    setChosenFilter(null);
    setFilters(EMPTY_FILTERS);
    loadMovements(EMPTY_FILTERS);
  };

  const openEntryDialog = (productId: string | null = null) => {
    setDialogProductId(productId);
    setDialogKey((k) => k + 1);
    setEntryDialogOpen(true);
  };

  const openAdjustDialog = (productId: string | null = null) => {
    setDialogProductId(productId);
    setDialogKey((k) => k + 1);
    setAdjustDialogOpen(true);
  };

  const handleMutationSuccess = () => {
    loadMovements(filters);
  };

  const openUnpackDialog = (productId: string) => {
    setUnpackProductId(pendingUnpack?.input.boxProductId ?? productId);
    setDialogKey((key) => key + 1);
  };

  const handleUnpackSuccess = async () => {
    const ids = [
      ...new Set(
        [unpackProductId, pendingUnpack?.input.boxProductId].filter((id): id is string => !!id),
      ),
    ];
    const result = await refreshUnpackProducts(ids);
    if (!result.success) throw new Error(result.error);
    const updated = result.products;
    setProducts((current) =>
      current
        .filter((p) => !ids.includes(p.id) || updated.some((row) => row.id === p.id))
        .map((p) => updated.find((row) => row.id === p.id) ?? p),
    );
    await loadMovements(filters);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Controle de Estoque"
        icon={Boxes}
        description="Registre entradas, ajuste saldos e acompanhe o histórico de movimentações."
        actions={
          canManage && (
            <>
              <Button variant="outline" onClick={() => setView("boxes")}>
                <PackageOpen />
                Abrir caixas
              </Button>
              <Button variant="outline" onClick={() => openAdjustDialog()}>
                <ClipboardCheck />
                Ajustar Estoque
              </Button>
              <Button onClick={() => openEntryDialog()}>
                <PackagePlus />
                Registrar Entrada
              </Button>
            </>
          )
        }
      />

      {canManage && pendingUnpack && (
        <Card className="border-info/40 bg-info/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-sm">
              <p className="font-semibold">
                {pendingUnpack.data ? "Abertura registrada" : "Abertura aguardando confirmação"}
              </p>
              <p className="text-muted-foreground text-xs">
                {pendingUnpack.boxName}: {pendingUnpack.input.boxQuantity} caixa(s). Verifique a
                operação antes de abrir outras caixas.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => openUnpackDialog(pendingUnpack.input.boxProductId)}
            >
              {pendingUnpack.data ? "Atualizar saldos" : "Verificar abertura"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Produtos cadastrados</CardTitle>
            <Package className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{counts.total}</div>
          </CardContent>
        </Card>

        <Card
          className={cn("hover:border-primary/50 cursor-pointer transition-colors")}
          onClick={() => setView("low")}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Abaixo do mínimo</CardTitle>
            <AlertTriangle
              className={cn(
                "h-4 w-4",
                counts.low > 0 ? "text-destructive" : "text-muted-foreground",
              )}
            />
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", counts.low > 0 && "text-destructive")}>
              {counts.low}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Sem saldo</CardTitle>
            <PackageX className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{outOfStockCount}</div>
          </CardContent>
        </Card>
      </div>

      {counts.negative > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="text-destructive mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div className="text-sm">
                <p className="text-destructive font-semibold">
                  {counts.negative === 1
                    ? "1 produto com saldo negativo"
                    : `${counts.negative} produtos com saldo negativo`}
                </p>
                <p className="text-muted-foreground text-xs">
                  Vendas feitas sem internet baixaram mais do que o saldo do sistema. Confira a
                  contagem e ajuste o estoque; as pendências ficam em Sincronização offline.
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={() => setView("negative")}>
              Consultar saldos negativos
            </Button>
            <ul className="divide-y rounded-lg border text-sm">
              {negativeStock.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="font-medium">{p.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-destructive font-mono font-semibold">
                      {formatQuantity(p.currentStock, p.unit)} {p.unit}
                    </span>
                    {canManage && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        onClick={() => openAdjustDialog(p.id)}
                      >
                        <ClipboardCheck className="h-3.5 w-3.5" />
                        Ajustar
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {view !== "history" && (
        <Input
          aria-label="Buscar no estoque"
          placeholder="Buscar por nome, código ou SKU"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      {view !== "history" && <ListPagination {...pagination} />}
      {/* View switch */}
      <div className="bg-muted/40 flex w-fit max-w-full flex-wrap gap-1 rounded-lg border p-1">
        <Button
          size="sm"
          variant={view === "history" ? "default" : "ghost"}
          onClick={() => setView("history")}
          className="gap-1.5"
        >
          <History className="h-4 w-4" />
          Histórico de Movimentações
        </Button>
        <Button
          size="sm"
          variant={view === "low" ? "default" : "ghost"}
          onClick={() => setView("low")}
          className="gap-1.5"
        >
          <AlertTriangle className="h-4 w-4" />
          Abaixo do Mínimo ({counts.low})
        </Button>
        {canManage && (
          <Button
            size="sm"
            variant={view === "boxes" ? "default" : "ghost"}
            onClick={() => setView("boxes")}
            className="gap-1.5"
          >
            <PackageOpen className="h-4 w-4" />
            Caixas vinculadas
          </Button>
        )}
      </div>

      {view === "boxes" ? (
        <Card>
          <CardContent className="p-0">
            {linkedBoxes.length === 0 ? (
              <div className="p-8 text-center">
                <p className="font-semibold">Nenhuma caixa vinculada</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  No cadastro de produtos, vincule uma caixa (CX) ao produto avulso (UN) e informe
                  quantas unidades ela contém.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Caixa fechada</TableHead>
                    <TableHead>Produto avulso</TableHead>
                    <TableHead className="text-right">Caixas</TableHead>
                    <TableHead className="text-right">Avulsas</TableHead>
                    <TableHead className="text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linkedBoxes.map((box) => {
                    const unit = box.containedProduct!;
                    return (
                      <TableRow key={box.id}>
                        <TableCell className="min-w-40 font-medium whitespace-normal">
                          {box.name}
                          <p className="text-muted-foreground mt-1 text-xs font-normal">
                            1 caixa = {box.unitsPerBox} unidades
                          </p>
                        </TableCell>
                        <TableCell className="min-w-40 whitespace-normal">{unit.name}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatQuantity(box.currentStock, "CX")} CX
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatQuantity(unit.currentStock, "UN")} UN
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openUnpackDialog(box.id)}
                          >
                            <PackageOpen className="h-3.5 w-3.5" />
                            Abrir caixas
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : view === "low" || view === "negative" || view === "zero" ? (
        <Card>
          <CardContent className="p-0">
            {lowStock.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center">
                <Boxes className="text-muted-foreground/50 mb-3 h-12 w-12" />
                <h3 className="text-base font-semibold">Nenhum produto abaixo do mínimo</h3>
                <p className="text-muted-foreground mt-1 max-w-sm text-sm">
                  Todos os produtos estão com saldo acima do estoque mínimo configurado.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead className="text-right">Mínimo</TableHead>
                    <TableHead className="text-right">Déficit</TableHead>
                    {canManage && <TableHead className="text-center">Ações</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lowStock.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="min-w-40 font-medium whitespace-normal">
                        {p.name}
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
                      <TableCell
                        className={cn(
                          "text-right font-mono",
                          p.currentStock <= 0 && "text-destructive font-semibold",
                        )}
                      >
                        {formatQuantity(p.currentStock, p.unit)} {p.unit}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right font-mono">
                        {formatQuantity(p.minStock, p.unit)} {p.unit}
                      </TableCell>
                      <TableCell className="text-destructive text-right font-mono font-semibold">
                        {formatQuantity(p.deficit, p.unit)} {p.unit}
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-center">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEntryDialog(p.id)}
                            className="gap-1"
                          >
                            <PackagePlus className="h-3.5 w-3.5" />
                            Entrada
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Filters */}
          <Card>
            <CardContent className="grid grid-cols-1 items-end gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]">
              <div className="space-y-1">
                <Label
                  htmlFor="stock-manager-produto"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Produto
                </Label>
                <ProductLookup
                  label="Produto"
                  value={filters.productId}
                  selected={chosenFilter}
                  onSelect={(item) => {
                    setChosenFilter(item);
                    updateFilters({ productId: item?.id ?? "" });
                  }}
                  emptyLabel="Todos os produtos"
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="stock-manager-tipo"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Tipo
                </Label>
                <OptionSelect
                  id="stock-manager-tipo"
                  value={filters.type}
                  onValueChange={(v) => updateFilters({ type: v as Filters["type"] })}
                  options={[
                    { value: "", label: "Todos" },
                    { value: "IN", label: "Entrada" },
                    { value: "OUT", label: "Saída" },
                    { value: "ADJUSTMENT", label: "Ajuste" },
                  ]}
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="stock-manager-de"
                  className="text-muted-foreground text-xs font-medium"
                >
                  De
                </Label>
                <Input
                  id="stock-manager-de"
                  type="date"
                  value={filters.from}
                  max={filters.to || undefined}
                  onChange={(e) => updateFilters({ from: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="stock-manager-ate"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Até
                </Label>
                <Input
                  id="stock-manager-ate"
                  type="date"
                  value={filters.to}
                  min={filters.from || undefined}
                  onChange={(e) => updateFilters({ to: e.target.value })}
                />
              </div>
              <Button
                variant="ghost"
                onClick={clearFilters}
                disabled={!hasFilters}
                className="gap-1"
              >
                <X className="h-4 w-4" />
                Limpar
              </Button>
            </CardContent>
          </Card>

          {/* History */}
          <Card>
            <CardContent className="p-0">
              {movements.items.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-center">
                  {loadingMovements ? (
                    <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
                  ) : (
                    <>
                      <History className="text-muted-foreground/50 mb-3 h-12 w-12" />
                      <h3 className="text-base font-semibold">Nenhuma movimentação encontrada</h3>
                      <p className="text-muted-foreground mt-1 max-w-sm text-sm">
                        {hasFilters
                          ? "Tente ajustar os filtros para encontrar as movimentações desejadas."
                          : "Entradas, vendas e ajustes aparecerão aqui."}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <Table className={cn(loadingMovements && "opacity-60")}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Produto</TableHead>
                        <TableHead className="text-center">Tipo</TableHead>
                        <TableHead className="text-right">Quantidade</TableHead>
                        {canSeeCost && <TableHead className="text-right">Custo Unit.</TableHead>}
                        <TableHead>Fornecedor</TableHead>
                        <TableHead>Motivo</TableHead>
                        <TableHead>Usuário</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {movements.items.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell
                            className="text-muted-foreground text-xs whitespace-nowrap"
                            suppressHydrationWarning
                          >
                            {formatDateTime(m.createdAt)}
                          </TableCell>
                          <TableCell className="min-w-40 font-medium whitespace-normal">
                            {m.productName}
                          </TableCell>
                          <TableCell className="text-center">
                            <MovementTypeBadge type={m.type} />
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-mono whitespace-nowrap",
                              m.type === "IN" && "text-success",
                              m.type === "ADJUSTMENT" && m.quantity < 0 && "text-destructive",
                            )}
                          >
                            {signedQuantity(m)} {m.unit}
                          </TableCell>
                          {canSeeCost && (
                            <TableCell className="text-muted-foreground text-right">
                              {m.unitCost != null ? formatCurrency(m.unitCost) : "-"}
                              {m.totalCost != null && (
                                <p className="mt-1 text-xs">Total: {formatCurrency(m.totalCost)}</p>
                              )}
                              {!!m.extraCostUnits && m.unitCost != null && (
                                <p className="mt-1 text-xs">
                                  {m.extraCostUnits} un. a {formatCurrency(m.unitCost + 0.01)}
                                </p>
                              )}
                            </TableCell>
                          )}
                          <TableCell className="text-sm">{m.supplierName ?? "-"}</TableCell>
                          <TableCell className="text-muted-foreground max-w-56 truncate text-sm">
                            <span title={m.reason ?? undefined}>{m.reason ?? "-"}</span>
                            {m.conversionId && (
                              <p className="mt-1 text-xs" title={m.conversionId}>
                                Abertura {m.conversionId.slice(0, 8)}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{m.userName ?? "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  <div className="text-muted-foreground flex items-center justify-between border-t px-4 py-3 text-xs">
                    <span>
                      Exibindo {movements.items.length} de {movements.total} movimentações
                    </span>
                    {offset > 0 && (
                      <Button
                        variant="outline"
                        disabled={loadingMovements}
                        onClick={() => loadMovements(filters, Math.max(0, offset - PAGE_SIZE))}
                      >
                        Página anterior
                      </Button>
                    )}
                    {offset + movements.items.length < movements.total && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => loadMovements(filters, offset + PAGE_SIZE)}
                        disabled={loadingMovements}
                      >
                        {loadingMovements && (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        )}
                        Próxima página
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Modals */}
      <StockEntryDialog
        key={`entry-${dialogKey}`}
        open={entryDialogOpen}
        onOpenChange={setEntryDialogOpen}
        products={products}
        suppliers={suppliers}
        initialProductId={dialogProductId}
        onSuccess={handleMutationSuccess}
      />

      <StockAdjustDialog
        key={`adjust-${dialogKey}`}
        open={adjustDialogOpen}
        onOpenChange={setAdjustDialogOpen}
        products={products}
        initialProductId={dialogProductId}
        onSuccess={handleMutationSuccess}
      />
      {canManage && dialogBox && dialogUnit && (
        <StockUnpackDialog
          key={`unpack-${dialogKey}`}
          open={unpackProductId !== null}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setUnpackProductId(null);
          }}
          boxProduct={dialogBox}
          unitProduct={dialogUnit}
          operationScope={operationScope}
          onSuccess={handleUnpackSuccess}
        />
      )}
    </div>
  );
}
