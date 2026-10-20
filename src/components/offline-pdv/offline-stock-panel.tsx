"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Boxes, CircleAlert, ExternalLink, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OptionSelect } from "@/components/option-select";
import { readMeta, userDb } from "@/lib/offline/db";
import { reservedQuantities } from "@/lib/offline/sale-operation";
import {
  buildStockRows,
  filterStockRows,
  STOCK_STALE_WARNING_MS,
  type StockFilter,
} from "@/lib/offline/stock-view";
import { formatQuantity } from "@/lib/stock";
import { formatStoreDateTime } from "@/lib/store-time";
import { cn } from "@/lib/utils";

// Consulta de estoque do /pdv (issue #54, docs/OFFLINE.md seção 6.2): só leitura, a partir da
// cópia local, com e sem conexão. Abre por cima do terminal, que continua montado: o carrinho em
// montagem não se perde ao consultar. Entrada e ajuste continuam no /admin/estoque, com conexão.
// Disponível e situação vêm logo depois do produto: na tela do celular, o resto fica na rolagem.

interface OfflineStockPanelProps {
  userId: string;
  online: boolean;
  // Com conexão e permissão "stock.manage": link para entrada e ajuste no painel
  canManageStock: boolean;
}

export function OfflineStockPanel({ userId, online, canManageStock }: OfflineStockPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <Boxes className="h-4 w-4" />
        Estoque
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-3 sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Consulta de estoque</DialogTitle>
            <DialogDescription>
              Saldo da última sincronização menos as vendas deste aparelho ainda não refletidas.
              Somente consulta.
            </DialogDescription>
          </DialogHeader>
          {open && <StockList userId={userId} online={online} canManageStock={canManageStock} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

// Relógio da idade dos dados, atualizado a cada minuto
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const EMPTY_FILTER: StockFilter = { query: "", categoryId: "", onlyLow: false };

function StockList({ userId, online, canManageStock }: OfflineStockPanelProps) {
  const now = useNow();
  const [filter, setFilter] = useState<StockFilter>(EMPTY_FILTER);
  const update = (patch: Partial<StockFilter>) => setFilter((prev) => ({ ...prev, ...patch }));

  const data = useLiveQuery(async () => {
    const db = userDb(userId);
    const [products, categories, operations, sync] = await Promise.all([
      db.products.toArray(),
      db.categories.toArray(),
      db.operations.toArray(),
      readMeta(db, "sync"),
    ]);
    return { products, categories, operations, sync };
  }, [userId]);

  const rows = useMemo(() => {
    if (!data) return [];
    const reserved = reservedQuantities(data.operations, data.sync?.watermark);
    return buildStockRows(data.products, data.categories, reserved);
  }, [data]);
  const visible = useMemo(() => filterStockRows(rows, filter), [rows, filter]);
  const categories = useMemo(
    () => [...(data?.categories ?? [])].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [data?.categories],
  );

  if (!data) {
    return <p className="text-muted-foreground py-8 text-center text-sm">Carregando...</p>;
  }

  const syncedAt = data.sync?.syncedAt ?? null;
  const age = syncedAt ? now - syncedAt : null;
  const stale = age !== null && age > STOCK_STALE_WARNING_MS;
  const lowCount = rows.filter((row) => row.low === true).length;
  const unknownMin = rows.some((row) => row.minStock === null);

  return (
    <>
      <div role="status" className="space-y-1 text-xs">
        {syncedAt && (
          <p className={cn("text-muted-foreground", stale && "text-warning font-medium")}>
            {stale && <CircleAlert className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />}
            Dados de {formatStoreDateTime(new Date(syncedAt).toISOString())}
            {stale ? ": podem estar desatualizados. Sincronize assim que houver conexão." : "."}
          </p>
        )}
        {online ? (
          canManageStock && (
            <a
              href="/admin/estoque"
              className={cn(buttonVariants({ size: "sm", variant: "link" }), "h-auto gap-1 p-0")}
            >
              Entrada e ajuste no painel
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )
        ) : (
          <p className="text-muted-foreground">
            Sem conexão com o servidor: entrada e ajuste de estoque só com conexão.
          </p>
        )}
        {unknownMin && (
          <p className="text-muted-foreground">
            Alguns produtos ainda não têm o estoque mínimo neste aparelho. Ele chega na próxima
            preparação do PDV.
          </p>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_14rem_auto] sm:items-center">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
          <Input
            type="search"
            aria-label="Buscar produto por nome, SKU ou código de barras"
            placeholder="Nome, SKU ou código de barras"
            className="pl-8"
            value={filter.query}
            onChange={(e) => update({ query: e.target.value })}
          />
        </div>
        <OptionSelect
          aria-label="Filtrar por categoria"
          value={filter.categoryId}
          onValueChange={(categoryId) => update({ categoryId })}
          options={[
            { value: "", label: "Todas as categorias" },
            ...categories.map((c) => ({ value: c.id, label: c.name })),
            { value: "none", label: "Sem categoria" },
          ]}
        />
        <div className="flex items-center gap-2">
          <Checkbox
            id="pdv-estoque-baixo"
            checked={filter.onlyLow}
            onCheckedChange={(checked) => update({ onlyLow: checked })}
          />
          <Label htmlFor="pdv-estoque-baixo" className="text-sm font-normal whitespace-nowrap">
            Só estoque baixo ({lowCount})
          </Label>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        {visible.length === 0 ? (
          <p className="text-muted-foreground p-8 text-center text-sm">
            {rows.length === 0 ? "Nenhum produto neste aparelho." : "Nenhum produto encontrado."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Disponível</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Sincronizado</TableHead>
                <TableHead className="text-right">Vendas pendentes</TableHead>
                <TableHead className="text-right">Mínimo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.id} data-testid="stock-row">
                  <TableCell className="min-w-32 whitespace-normal sm:min-w-44">
                    <p className="font-medium">{row.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {[row.categoryName, row.sku, row.barcode].filter(Boolean).join(" · ") ||
                        "Sem categoria"}
                    </p>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono font-semibold",
                      row.available < 0 && "text-destructive",
                    )}
                  >
                    {formatQuantity(row.available, row.unit)} {row.unit}
                  </TableCell>
                  <TableCell>
                    {row.available < 0 ? (
                      <Badge variant="destructive">Saldo negativo</Badge>
                    ) : row.low === true ? (
                      <Badge variant="warning">Estoque baixo</Badge>
                    ) : row.low === false ? (
                      <Badge variant="secondary">Normal</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">Mínimo não sincronizado</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono">
                    {formatQuantity(row.syncedStock, row.unit)} {row.unit}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono">
                    {row.pending > 0 ? `${formatQuantity(row.pending, row.unit)} ${row.unit}` : "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono">
                    {row.minStock === null
                      ? "-"
                      : `${formatQuantity(row.minStock, row.unit)} ${row.unit}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        {visible.length} de {rows.length} produtos
      </p>
    </>
  );
}
