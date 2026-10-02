"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { HandCoins, Loader2 } from "lucide-react";
import { ReceivableItem, registerReceivablePayment } from "@/actions/receivables";
import {
  PAYMENT_METHOD_LABELS,
  PaymentMethodValue,
  RECEIVABLE_PAYMENT_METHODS,
} from "@/lib/payments";
import { cn, formatCurrency } from "@/lib/utils";
import { Label } from "@/components/ui/label";

interface ReceivablePaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receivable: ReceivableItem | null;
  hasOpenCashRegister: boolean;
  onSuccess: () => void;
}

// O componente pai troca a `key` a cada abertura, reiniciando o formulário
export function ReceivablePaymentDialog({
  open,
  onOpenChange,
  receivable,
  hasOpenCashRegister,
  onSuccess,
}: ReceivablePaymentDialogProps) {
  const [amount, setAmount] = useState<number | null>(receivable ? receivable.balance : null);
  const [method, setMethod] = useState<PaymentMethodValue>("MONEY");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receivable) return;
    const value = amount ?? Number.NaN;
    if (!Number.isFinite(value) || value <= 0) {
      setError("Informe um valor de recebimento maior que zero.");
      return;
    }
    if (value > receivable.balance) {
      setError("O valor recebido não pode ser maior que o saldo devedor.");
      return;
    }
    if (method === "MONEY" && !hasOpenCashRegister) {
      setError("Abra o caixa antes de receber em dinheiro.");
      return;
    }

    setLoading(true);
    setError(null);
    const res = await registerReceivablePayment({
      receivableId: receivable.id,
      amount: value,
      method,
    });
    setLoading(false);

    if (res.success) {
      onOpenChange(false);
      onSuccess();
    } else {
      setError(res.error || "Erro ao registrar o recebimento.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <HandCoins className="text-primary h-5 w-5" />
            <DialogTitle>Registrar Recebimento</DialogTitle>
          </div>
          {receivable && (
            <DialogDescription>
              {receivable.customerName} · Venda #{receivable.saleCode}
            </DialogDescription>
          )}
        </DialogHeader>

        {error && (
          <div className="text-destructive bg-destructive/10 border-destructive/20 rounded-md border p-2.5 text-xs">
            {error}
          </div>
        )}

        {receivable && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-3 gap-3 rounded-lg border p-3 text-sm">
              <div>
                <div className="text-muted-foreground text-xs">Valor</div>
                <div className="font-mono">{formatCurrency(receivable.amount)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Pago</div>
                <div className="font-mono">{formatCurrency(receivable.paidAmount)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Saldo devedor</div>
                <div className="text-destructive font-mono font-semibold">
                  {formatCurrency(receivable.balance)}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <p id="receivable-forma-recebimento" className="text-foreground text-xs font-medium">
                Forma de recebimento
              </p>
              <div
                role="group"
                aria-labelledby="receivable-forma-recebimento"
                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              >
                {RECEIVABLE_PAYMENT_METHODS.map((m) => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={method === m ? "default" : "outline"}
                    aria-pressed={method === m}
                    onClick={() => setMethod(m)}
                    className={cn("w-full")}
                  >
                    {PAYMENT_METHOD_LABELS[m]}
                  </Button>
                ))}
              </div>
              {method === "MONEY" && !hasOpenCashRegister && (
                <p className="text-destructive text-[11px]">
                  Recebimento em dinheiro exige caixa aberto.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label
                htmlFor="receivable-payment-valor-recebido-r"
                className="text-foreground text-xs font-medium"
              >
                Valor recebido (R$) <span className="text-destructive">*</span>
              </Label>
              <MoneyInput
                id="receivable-payment-valor-recebido-r"
                value={amount}
                onValueChange={setAmount}
                required
                autoFocus
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando...
                  </>
                ) : (
                  "Confirmar Recebimento"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
