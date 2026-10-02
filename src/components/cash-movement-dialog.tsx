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
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { ArrowDownToLine, ArrowUpFromLine, Loader2 } from "lucide-react";
import { CashMovementTypeValue, registerCashMovement } from "@/actions/cash-register";
import { formatCurrency } from "@/lib/utils";
import { Label } from "@/components/ui/label";

interface CashMovementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: CashMovementTypeValue;
  expectedCash: number;
  onSuccess: () => void;
}

// O componente pai troca a `key` a cada abertura, reiniciando o formulário
export function CashMovementDialog({
  open,
  onOpenChange,
  type,
  expectedCash,
  onSuccess,
}: CashMovementDialogProps) {
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isWithdrawal = type === "WITHDRAWAL";
  const Icon = isWithdrawal ? ArrowUpFromLine : ArrowDownToLine;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = amount ?? Number.NaN;
    if (!Number.isFinite(value) || value <= 0) {
      setError("Informe um valor maior que zero.");
      return;
    }
    if (isWithdrawal && value > expectedCash) {
      setError("A sangria não pode ser maior que o dinheiro disponível no caixa.");
      return;
    }
    if (!reason.trim()) {
      setError("Informe o motivo da movimentação.");
      return;
    }

    setLoading(true);
    setError(null);
    const res = await registerCashMovement({ type, amount: value, reason: reason.trim() });
    setLoading(false);

    if (res.success) {
      onOpenChange(false);
      onSuccess();
    } else {
      setError(res.error || "Erro ao registrar a movimentação.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Icon className="text-primary h-5 w-5" />
            <DialogTitle>{isWithdrawal ? "Sangria" : "Suprimento"}</DialogTitle>
          </div>
          <DialogDescription>
            {isWithdrawal
              ? "Retirada de dinheiro da gaveta (ex.: depósito, pagamento de despesa)."
              : "Entrada de dinheiro na gaveta (ex.: reforço de troco)."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="text-destructive bg-destructive/10 border-destructive/20 rounded-md border p-2.5 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-muted-foreground text-xs">
            Dinheiro esperado na gaveta:{" "}
            <span className="text-foreground font-mono font-medium">
              {formatCurrency(expectedCash)}
            </span>
          </p>

          <div className="space-y-1">
            <Label htmlFor="cash-movement-valor-r" className="text-foreground text-xs font-medium">
              Valor (R$) <span className="text-destructive">*</span>
            </Label>
            <MoneyInput
              id="cash-movement-valor-r"
              value={amount}
              onValueChange={setAmount}
              required
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="cash-movement-motivo" className="text-foreground text-xs font-medium">
              Motivo <span className="text-destructive">*</span>
            </Label>
            <Input
              id="cash-movement-motivo"
              placeholder={isWithdrawal ? "Ex: Depósito bancário" : "Ex: Reforço de troco"}
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
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
              ) : isWithdrawal ? (
                "Registrar Sangria"
              ) : (
                "Registrar Suprimento"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
