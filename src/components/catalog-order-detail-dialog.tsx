"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ClipboardList, Loader2, MessageCircle, ShoppingCart, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/confirm-dialog";
import {
  cancelCatalogOrder,
  getCatalogOrderDetail,
  type CatalogOrderDetail,
} from "@/actions/catalog-orders";
import { CatalogOrderStatusBadge } from "@/components/catalog-order-status";
import { formatStoreDateTime } from "@/lib/store-time";
import { formatCurrency, formatNumber } from "@/lib/utils";

const INTEGER_UNITS = ["UN", "CX"];

// O componente pai troca a `key` a cada abertura, então o detalhe é buscado na montagem
export function CatalogOrderDetailDialog({
  open,
  onOpenChange,
  orderId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string | null;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<CatalogOrderDetail | null>(null);
  const [loading, setLoading] = useState(!!orderId);
  const [failed, setFailed] = useState(false);
  const [reason, setReason] = useState("");
  const [canceling, setCanceling] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [askConfirm, confirmDialog] = useConfirm();

  useEffect(() => {
    if (!orderId) return;
    let active = true;
    getCatalogOrderDetail(orderId).then((result) => {
      if (!active) return;
      setDetail(result);
      setFailed(!result);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [orderId, reloadKey]);

  const handleCancel = async () => {
    if (!detail) return;
    const confirmed = await askConfirm({
      title: `Cancelar o pedido nº ${detail.code}?`,
      description:
        "O pedido sai da lista de disponíveis e não poderá ser carregado no PDV. Nenhuma venda, estoque ou caixa é alterado.",
      confirmLabel: "Cancelar pedido",
      cancelLabel: "Voltar",
      destructive: true,
    });
    if (!confirmed) return;
    setCanceling(true);
    const result = await cancelCatalogOrder({ id: detail.id, reason });
    setCanceling(false);
    if (result.success) {
      toast.success(`Pedido nº ${detail.code} cancelado.`);
    } else {
      toast.error(result.error);
    }
    setReloadKey((k) => k + 1);
    onChanged?.();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <ClipboardList className="text-primary h-5 w-5" />
              <DialogTitle>
                {detail ? `Pedido nº ${detail.code}` : "Pedido do catálogo"}
              </DialogTitle>
              {detail && <CatalogOrderStatusBadge status={detail.status} />}
            </div>
            {detail && (
              <DialogDescription suppressHydrationWarning>
                Registrado em {formatStoreDateTime(detail.createdAt)} por {detail.createdByName}, ao
                abrir o link do pedido.
              </DialogDescription>
            )}
          </DialogHeader>

          {loading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
            </div>
          ) : failed || !detail ? (
            <p className="text-muted-foreground p-4 text-sm">
              Não foi possível carregar este pedido.
            </p>
          ) : (
            <div className="space-y-6">
              {detail.canceled && (
                <div
                  className="border-destructive/30 bg-destructive/5 space-y-1 rounded-lg border p-3 text-sm"
                  suppressHydrationWarning
                >
                  <p className="font-medium">
                    Cancelado em {formatStoreDateTime(detail.canceled.at)}
                    {detail.canceled.byName && ` por ${detail.canceled.byName}`}
                  </p>
                  {detail.canceled.reason && (
                    <p className="text-muted-foreground">Motivo: {detail.canceled.reason}</p>
                  )}
                </div>
              )}
              {detail.converted && (
                <div
                  className="border-success/30 bg-success/5 rounded-lg border p-3 text-sm"
                  suppressHydrationWarning
                >
                  <p className="font-medium">
                    Concluído como venda
                    {detail.converted.saleCode !== null && ` #${detail.converted.saleCode}`} em{" "}
                    {formatStoreDateTime(detail.converted.at)}
                    {detail.converted.byName && ` por ${detail.converted.byName}`}
                  </p>
                </div>
              )}

              <p className="text-muted-foreground flex gap-2 rounded-lg border p-3 text-sm">
                <MessageCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                Nome, entrega, endereço e observação do cliente estão na conversa do WhatsApp; o
                sistema não guarda dados pessoais do pedido.
              </p>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Itens no momento do pedido</h3>
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produto</TableHead>
                        <TableHead className="text-right">Qtd.</TableHead>
                        <TableHead className="text-right">Unitário</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="whitespace-normal">
                            <span>{item.productName}</span>
                            {item.productDeleted && (
                              <Badge variant="secondary" className="ml-2 text-[11px]">
                                excluído
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono whitespace-nowrap">
                            {formatNumber(item.quantity, INTEGER_UNITS.includes(item.unit) ? 0 : 3)}{" "}
                            {item.unit}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(item.unitPrice)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(item.subtotal)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="ml-auto flex max-w-xs justify-between text-base font-semibold">
                  <span>Total estimado</span>
                  <span className="font-mono">{formatCurrency(detail.estimatedTotal)}</span>
                </div>
                <p className="text-muted-foreground text-xs">
                  No PDV valem o preço e o estoque atuais; as diferenças aparecem antes da venda.
                </p>
              </div>

              {detail.status === "OPEN" && (
                <div className="space-y-1">
                  <Label htmlFor="pedido-motivo" className="text-xs font-medium">
                    Motivo do cancelamento (opcional)
                  </Label>
                  <Input
                    id="pedido-motivo"
                    maxLength={300}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          {detail?.status === "OPEN" && (
            <DialogFooter>
              <Button variant="destructive" disabled={canceling} onClick={handleCancel}>
                {canceling ? <Loader2 className="animate-spin" /> : <XCircle />} Cancelar pedido
              </Button>
              <Link
                href={`/admin/pdv?pedido=${encodeURIComponent(detail.id)}`}
                className={buttonVariants()}
              >
                <ShoppingCart /> Carregar no PDV
              </Link>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </>
  );
}
