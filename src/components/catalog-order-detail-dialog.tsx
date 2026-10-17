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
import { displayPhone } from "@/lib/masks";
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

              <div className="grid grid-cols-1 gap-3 rounded-lg border p-3 text-sm sm:grid-cols-2">
                <div>
                  <div className="text-muted-foreground text-xs">Cliente</div>
                  <div className="font-medium break-words">
                    {detail.customerName ?? "Não informado"}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {detail.customer
                      ? `Cadastro: ${detail.customer.name}${detail.customer.deleted ? " (excluído)" : ""}`
                      : "Sem cadastro com este telefone"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Telefone</div>
                  {detail.customerPhone ? (
                    <>
                      <div className="font-medium">{displayPhone(detail.customerPhone)}</div>
                      <a
                        href={`https://wa.me/55${detail.customerPhone}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary inline-flex min-h-11 items-center gap-1 font-medium underline-offset-4 hover:underline"
                      >
                        <MessageCircle className="size-4" aria-hidden /> Abrir conversa
                      </a>
                    </>
                  ) : (
                    <div className="text-muted-foreground">Não informado</div>
                  )}
                </div>
                <p className="text-muted-foreground text-xs sm:col-span-2">
                  Entrega, endereço e observação estão na mensagem do WhatsApp.
                </p>
              </div>

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
