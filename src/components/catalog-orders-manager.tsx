"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ClipboardList, Eye } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ListPagination } from "@/components/list-pagination";
import { CatalogOrderDetailDialog } from "@/components/catalog-order-detail-dialog";
import {
  CATALOG_ORDER_STATUS_LABELS,
  CatalogOrderStatusBadge,
} from "@/components/catalog-order-status";
import type { CatalogOrderListItem } from "@/actions/catalog-orders";
import type { PageInfo } from "@/lib/pagination";
import { formatStoreDateTime } from "@/lib/store-time";
import { cn, formatCurrency } from "@/lib/utils";

const FILTERS = [
  { value: "OPEN", label: "Disponíveis" },
  { value: "CONVERTED", label: CATALOG_ORDER_STATUS_LABELS.CONVERTED },
  { value: "CANCELED", label: "Cancelados" },
  { value: "ALL", label: "Todos" },
] as const;

// Lista dos pedidos do catálogo (issue #81), filtrada pela URL (?status=&page=). ?pedido=<id> abre
// o detalhe direto (destino de quem acabou de abrir o link do pedido)
export function CatalogOrdersManager({
  orders,
  status,
  pagination,
  failed,
  initialOrderId,
}: {
  orders: CatalogOrderListItem[];
  status: string;
  pagination: PageInfo;
  failed: boolean;
  initialOrderId?: string | null;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string | null>(initialOrderId ?? null);
  const [dialogKey, setDialogKey] = useState(0);

  const setStatus = (value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("status", value);
    next.delete("page");
    startTransition(() => router.replace(`${path}?${next}`, { scroll: false }));
  };

  const closeDetail = () => {
    setSelected(null);
    if (params.has("pedido")) {
      const next = new URLSearchParams(params.toString());
      next.delete("pedido");
      router.replace(`${path}?${next}`, { scroll: false });
    }
  };

  const openDetail = (id: string) => {
    setDialogKey((k) => k + 1);
    setSelected(id);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pedidos do catálogo"
        icon={ClipboardList}
        description="Gerados ao abrir o link do pedido enviado pelo WhatsApp. Carregue no PDV para concluir a venda; o pedido não reserva estoque."
      />

      <div role="group" aria-label="Filtrar por situação" className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <Button
            key={filter.value}
            variant={status === filter.value ? "default" : "outline"}
            aria-pressed={status === filter.value}
            disabled={pending}
            onClick={() => setStatus(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className={cn("p-0", pending && "opacity-60")}>
          {failed ? (
            <EmptyState
              className="border-0"
              icon={ClipboardList}
              tone="destructive"
              title="Pedidos indisponíveis"
              description="Não foi possível consultar os pedidos agora. Recarregue a página em instantes."
            />
          ) : orders.length === 0 ? (
            <EmptyState
              className="border-0"
              icon={ClipboardList}
              title="Nenhum pedido encontrado"
              description={
                status === "OPEN"
                  ? "Os pedidos confirmados no catálogo aparecem aqui."
                  : "Nenhum pedido nesta situação."
              }
            />
          ) : (
            <>
              {/* Celular: cartões */}
              <ul className="divide-y md:hidden">
                {orders.map((order) => (
                  <li key={order.id}>
                    <button
                      type="button"
                      onClick={() => openDetail(order.id)}
                      className="hover:bg-muted/50 flex w-full flex-col gap-1 p-4 text-left"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold">Pedido nº {order.code}</span>
                        <CatalogOrderStatusBadge status={order.status} />
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {order.itemCount} {order.itemCount === 1 ? "item" : "itens"} · registrado
                        por {order.createdByName}
                      </span>
                      <span className="text-muted-foreground flex justify-between gap-2 text-xs">
                        <span suppressHydrationWarning>{formatStoreDateTime(order.createdAt)}</span>
                        <span className="text-foreground font-mono text-sm">
                          {formatCurrency(order.estimatedTotal)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              {/* Desktop: tabela */}
              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Recebido em</TableHead>
                    <TableHead>Registrado por</TableHead>
                    <TableHead className="text-right">Itens</TableHead>
                    <TableHead className="text-right">Total estimado</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">nº {order.code}</TableCell>
                      <TableCell suppressHydrationWarning>
                        {formatStoreDateTime(order.createdAt)}
                      </TableCell>
                      <TableCell className="max-w-48 truncate">{order.createdByName}</TableCell>
                      <TableCell className="text-right font-mono">{order.itemCount}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(order.estimatedTotal)}
                      </TableCell>
                      <TableCell>
                        <CatalogOrderStatusBadge status={order.status} />
                        {order.saleCode !== null && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            Venda #{order.saleCode}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openDetail(order.id)}
                          aria-label={`Ver pedido nº ${order.code}`}
                        >
                          <Eye /> Ver
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {!failed && pagination.total > 0 && <ListPagination {...pagination} />}

      <CatalogOrderDetailDialog
        key={dialogKey}
        open={selected !== null}
        onOpenChange={(open) => !open && closeDetail()}
        orderId={selected}
        onChanged={() => router.refresh()}
      />
    </div>
  );
}
