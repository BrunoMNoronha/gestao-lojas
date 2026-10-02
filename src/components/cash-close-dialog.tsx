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
import { Button } from "@/components/ui/button";
import { Lock, Loader2 } from "lucide-react";
import { closeCashRegister } from "@/actions/cash-register";
import { cn, formatCurrency } from "@/lib/utils";

interface CashCloseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expectedCash: number;
  onSuccess: () => void;
}

const parseMoneyInput = (value: string) => parseFloat(value.replace(",", "."));
const roundMoney = (value: number) => Math.round(value * 100) / 100;

// O componente pai troca a `key` a cada abertura, reiniciando o formulário
export function CashCloseDialog({
  open,
  onOpenChange,
  expectedCash,
  onSuccess,
}: CashCloseDialogProps) {
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countedValue = counted.trim() ? parseMoneyInput(counted) : Number.NaN;
  const difference = Number.isFinite(countedValue) ? roundMoney(countedValue - expectedCash) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!Number.isFinite(countedValue) || countedValue < 0) {
      setError("Informe o valor contado (zero ou mais).");
      return;
    }
    if (difference !== 0 && !note.trim()) {
      setError("Há diferença entre o contado e o esperado. Informe uma observação.");
      return;
    }

    setLoading(true);
    setError(null);
    const res = await closeCashRegister({ countedAmount: countedValue, note: note.trim() });
    setLoading(false);

    if (res.success) {
      onOpenChange(false);
      onSuccess();
    } else {
      setError(res.error || "Erro ao fechar o caixa.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Lock className="text-primary h-5 w-5" />
            <DialogTitle>Fechar Caixa</DialogTitle>
          </div>
          <DialogDescription>
            Conte o dinheiro da gaveta e informe o valor. O fechamento não pode ser desfeito.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="text-destructive bg-destructive/10 border-destructive/20 rounded-md border p-2.5 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-foreground text-xs font-medium">Esperado</label>
              <div className="border-input bg-muted/50 flex h-8 items-center rounded-lg border px-2.5 font-mono text-sm">
                {formatCurrency(expectedCash)}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-foreground text-xs font-medium">
                Contado <span className="text-destructive">*</span>
              </label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0,00"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label className="text-foreground text-xs font-medium">Diferença</label>
              <div
                className={cn(
                  "border-input bg-muted/50 flex h-8 items-center rounded-lg border px-2.5 font-mono text-sm font-semibold",
                  difference === 0 && "text-emerald-600 dark:text-emerald-400",
                  difference !== null && difference > 0 && "text-amber-600 dark:text-amber-400",
                  difference !== null && difference < 0 && "text-destructive",
                )}
              >
                {difference === null
                  ? "-"
                  : `${difference > 0 ? "+" : ""}${formatCurrency(difference)}`}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-foreground text-xs font-medium">
              Observação{" "}
              {difference !== null && difference !== 0 && (
                <span className="text-destructive">*</span>
              )}
            </label>
            <Input
              placeholder="Obrigatória quando houver diferença"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Fechando...
                </>
              ) : (
                "Confirmar Fechamento"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
