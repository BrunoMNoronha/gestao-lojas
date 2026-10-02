"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, ReceiptText } from "lucide-react";
import { CashRegisterDetail, getCashRegisterDetail } from "@/actions/cash-register";
import { CashSummary } from "@/components/cash-summary";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments";
import { formatDateTime } from "@/lib/dates";
import { cn, formatCurrency } from "@/lib/utils";

interface CashRegisterDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cashRegisterId: string | null;
}

// O componente pai troca a `key` a cada abertura, então o detalhe é buscado na montagem
export function CashRegisterDetailDialog({
  open,
  onOpenChange,
  cashRegisterId,
}: CashRegisterDetailDialogProps) {
  const [detail, setDetail] = useState<CashRegisterDetail | null>(null);
  const [loading, setLoading] = useState(!!cashRegisterId);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!cashRegisterId) return;
    let active = true;
    getCashRegisterDetail(cashRegisterId).then((result) => {
      if (!active) return;
      setDetail(result);
      setFailed(!result);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [cashRegisterId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ReceiptText className="text-primary h-5 w-5" />
            <DialogTitle>Detalhe do Fechamento</DialogTitle>
          </div>
          {detail && (
            <DialogDescription suppressHydrationWarning>
              Operador {detail.userName} · aberto em {formatDateTime(detail.openedAt)}
              {detail.closedAt && ` · fechado em ${formatDateTime(detail.closedAt)}`}
            </DialogDescription>
          )}
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
          </div>
        ) : failed || !detail ? (
          <p className="text-muted-foreground p-4 text-sm">
            Não foi possível carregar o detalhe deste caixa.
          </p>
        ) : (
          <div className="space-y-6">
            {detail.expectedAmount !== null && (
              <div className="grid grid-cols-3 gap-3 rounded-lg border p-3 text-sm">
                <div>
                  <div className="text-muted-foreground text-xs">Esperado</div>
                  <div className="font-mono font-semibold">
                    {formatCurrency(detail.expectedAmount)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Contado</div>
                  <div className="font-mono font-semibold">
                    {formatCurrency(detail.countedAmount ?? 0)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Diferença</div>
                  <DifferenceValue value={detail.difference ?? 0} />
                </div>
                {detail.closingNote && (
                  <div className="text-muted-foreground col-span-3 text-xs">
                    Observação: {detail.closingNote}
                  </div>
                )}
              </div>
            )}

            <CashSummary summary={detail.summary} />

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Sangrias e suprimentos</h3>
              {detail.movements.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nenhuma movimentação.</p>
              ) : (
                <ul className="divide-y rounded-lg border text-sm">
                  {detail.movements.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[11px]",
                            m.type === "WITHDRAWAL"
                              ? "border-warning/30 text-warning"
                              : "border-success/30 text-success",
                          )}
                        >
                          {m.type === "WITHDRAWAL" ? "Sangria" : "Suprimento"}
                        </Badge>
                        <span>{m.reason}</span>
                      </div>
                      <div className="text-muted-foreground flex items-center gap-3 text-xs">
                        <span suppressHydrationWarning>{formatDateTime(m.createdAt)}</span>
                        <span className="text-foreground font-mono text-sm">
                          {formatCurrency(m.amount)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {detail.receivablePayments.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Recebimentos de fiado</h3>
                <ul className="divide-y rounded-lg border text-sm">
                  {detail.receivablePayments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span>
                        {p.customerName} · Venda #{p.saleCode} · {PAYMENT_METHOD_LABELS[p.method]}
                      </span>
                      <span className="font-mono">{formatCurrency(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DifferenceValue({ value }: { value: number }) {
  return (
    <span
      className={cn(
        "font-mono font-semibold",
        value === 0 && "text-success",
        value > 0 && "text-warning",
        value < 0 && "text-destructive",
      )}
    >
      {value > 0 ? "+" : ""}
      {formatCurrency(value)}
    </span>
  );
}
