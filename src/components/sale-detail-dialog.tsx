"use client";

import { useEffect, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Loader2, Printer, ShoppingCart } from "lucide-react";
import { getSaleDetail, type SaleDetail } from "@/actions/sales";
import type { StoreSettingsData } from "@/actions/settings";
import { ReceiptModal } from "@/components/receipt-modal";
import { PAYMENT_METHOD_LABELS, RECEIVABLE_STATUS_LABELS } from "@/lib/payments";
import { RECONCILIATION_ISSUE_LABELS } from "@/lib/reconciliation-labels";
import { formatStoreDate, formatStoreDateTime, isOverdue } from "@/lib/store-time";
import { displayDocument } from "@/lib/masks";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

interface SaleDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saleId: string | null;
  storeSettings: StoreSettingsData;
}

const OFFLINE_STATUS_LABELS: Record<NonNullable<SaleDetail["offline"]>["status"], string> = {
  APPLIED: "Lançada automaticamente",
  APPROVED: "Aprovada na conciliação",
  CONFLICT: "Em conflito",
  DISCARDED: "Descartada",
};

const INTEGER_UNITS = ["UN", "CX"];

// O componente pai troca a `key` a cada abertura, então o detalhe é buscado na montagem
export function SaleDetailDialog({
  open,
  onOpenChange,
  saleId,
  storeSettings,
}: SaleDetailDialogProps) {
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [loading, setLoading] = useState(!!saleId);
  const [failed, setFailed] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);

  useEffect(() => {
    if (!saleId) return;
    let active = true;
    getSaleDetail(saleId).then((result) => {
      if (!active) return;
      setDetail(result);
      setFailed(!result);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [saleId]);

  const subtotal = detail ? detail.total + detail.discount : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <ShoppingCart className="text-primary h-5 w-5" />
              <DialogTitle>{detail ? `Venda #${detail.code}` : "Detalhe da venda"}</DialogTitle>
            </div>
            {detail && (
              <DialogDescription suppressHydrationWarning>
                {formatStoreDateTime(detail.occurredAt)} · operador {detail.userName}
              </DialogDescription>
            )}
          </DialogHeader>

          {loading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
            </div>
          ) : failed || !detail ? (
            <p className="text-muted-foreground p-4 text-sm">
              Não foi possível carregar esta venda.
            </p>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-3 rounded-lg border p-3 text-sm sm:grid-cols-3">
                <div>
                  <div className="text-muted-foreground text-xs">Cliente</div>
                  <div className="font-medium">{detail.customerName}</div>
                  {detail.customerDocument && (
                    <div className="text-muted-foreground text-xs">
                      {displayDocument(detail.customerDocument)}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Forma de pagamento</div>
                  <div className="font-medium">{PAYMENT_METHOD_LABELS[detail.paymentMethod]}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Caixa</div>
                  {detail.cashRegister ? (
                    <div suppressHydrationWarning>
                      <span className="font-medium">{detail.cashRegister.userName}</span>
                      <div className="text-muted-foreground text-xs">
                        aberto em {formatStoreDateTime(detail.cashRegister.openedAt)}
                      </div>
                    </div>
                  ) : (
                    <div className="text-muted-foreground">Sem caixa</div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Itens</h3>
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
                          <TableCell>
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
                <div className="ml-auto max-w-xs space-y-1 text-sm">
                  {detail.discount > 0 && (
                    <>
                      <div className="text-muted-foreground flex justify-between">
                        <span>Subtotal</span>
                        <span className="font-mono">{formatCurrency(subtotal)}</span>
                      </div>
                      <div className="text-destructive flex justify-between">
                        <span>Desconto</span>
                        <span className="font-mono">- {formatCurrency(detail.discount)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-base font-semibold">
                    <span>Total</span>
                    <span className="font-mono">{formatCurrency(detail.total)}</span>
                  </div>
                </div>
              </div>

              {detail.receivable && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">Fiado</h3>
                    <Badge
                      variant={detail.receivable.status === "PAID" ? "success" : "warning"}
                      className="text-[11px]"
                    >
                      {RECEIVABLE_STATUS_LABELS[detail.receivable.status]}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm sm:grid-cols-4">
                    <div>
                      <div className="text-muted-foreground text-xs">Valor</div>
                      <div className="font-mono font-semibold">
                        {formatCurrency(detail.receivable.amount)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Pago</div>
                      <div className="font-mono font-semibold">
                        {formatCurrency(detail.receivable.paidAmount)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Restante</div>
                      <div className="font-mono font-semibold">
                        {formatCurrency(detail.receivable.amount - detail.receivable.paidAmount)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Vencimento</div>
                      {detail.receivable.dueDate ? (
                        <div
                          suppressHydrationWarning
                          className={cn(
                            "font-medium",
                            detail.receivable.status !== "PAID" &&
                              isOverdue(detail.receivable.dueDate) &&
                              "text-destructive",
                          )}
                        >
                          {formatStoreDate(detail.receivable.dueDate)}
                        </div>
                      ) : (
                        <div className="text-muted-foreground">Sem vencimento</div>
                      )}
                    </div>
                  </div>
                  {detail.receivable.payments.length > 0 && (
                    <ul className="divide-y rounded-lg border text-sm">
                      {detail.receivable.payments.map((p) => (
                        <li
                          key={p.id}
                          className="flex items-center justify-between gap-3 px-3 py-2"
                        >
                          <span>
                            {PAYMENT_METHOD_LABELS[p.method]} · recebido por {p.userName}
                          </span>
                          <div className="text-muted-foreground flex items-center gap-3 text-xs">
                            <span suppressHydrationWarning>{formatStoreDateTime(p.createdAt)}</span>
                            <span className="text-foreground font-mono text-sm">
                              {formatCurrency(p.amount)}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {detail.offline && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Venda sem internet</h3>
                  <div
                    className="text-muted-foreground space-y-1 rounded-lg border p-3 text-sm"
                    suppressHydrationWarning
                  >
                    <p>
                      Registrada no aparelho{" "}
                      <span className="text-foreground font-medium">
                        {detail.offline.deviceName}
                      </span>{" "}
                      e recebida pelo servidor em {formatStoreDateTime(detail.offline.receivedAt)}.
                    </p>
                    <p>
                      {OFFLINE_STATUS_LABELS[detail.offline.status]}
                      {detail.offline.submittedByName &&
                        ` · enviada por ${detail.offline.submittedByName}`}
                    </p>
                  </div>
                </div>
              )}

              {detail.issues.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Pendências de conciliação</h3>
                  <ul className="divide-y rounded-lg border text-sm">
                    {detail.issues.map((issue) => (
                      <li
                        key={issue.id}
                        className="flex items-center justify-between gap-3 px-3 py-2"
                      >
                        <span>{RECONCILIATION_ISSUE_LABELS[issue.type] ?? issue.type}</span>
                        <Badge
                          variant={issue.acknowledged ? "success" : "warning"}
                          className="text-[11px]"
                        >
                          {issue.acknowledged ? "Conferida" : "A conferir"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {detail && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setReceiptOpen(true)}>
                <Printer className="mr-2 h-4 w-4" /> Reimprimir comprovante
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {detail && (
        <ReceiptModal
          open={receiptOpen}
          onOpenChange={setReceiptOpen}
          sale={detail}
          storeSettings={storeSettings}
          closeLabel="Fechar"
          title={`Comprovante da venda #${detail.code} (2ª via)`}
        />
      )}
    </>
  );
}
