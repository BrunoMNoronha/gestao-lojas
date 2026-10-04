"use client";

import { useEffect, useState } from "react";
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
import { CloudOff, Lock, Loader2, Smartphone } from "lucide-react";
import { closeCashRegister } from "@/actions/cash-register";
import { cn, formatCurrency } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import type { OfflineDevicePending } from "@/lib/offline-pending";
import { formatStoreDateTime } from "@/lib/store-time";

interface CashCloseDialogProps {
  open: boolean;
  cashRegisterId: string;
  // Outros aparelhos com vendas deste caixa ainda não enviadas, segundo o servidor (#38)
  offlinePending?: OfflineDevicePending[];
  onOpenChange: (open: boolean) => void;
  expectedCash: number;
  onSuccess: () => void;
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;

// O componente pai troca a `key` a cada abertura, reiniciando o formulário
export function CashCloseDialog({
  open,
  cashRegisterId,
  offlinePending = [],
  onOpenChange,
  expectedCash,
  onSuccess,
}: CashCloseDialogProps) {
  const [counted, setCounted] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Vendas do PDV sem internet deste navegador ainda não enviadas para este caixa (#38)
  const unsent = useUnsentOfflineSales(open, cashRegisterId);

  const countedValue = counted ?? Number.NaN;
  const difference = Number.isFinite(countedValue) ? roundMoney(countedValue - expectedCash) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (unsent > 0) return;
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

        {unsent > 0 && (
          <div
            role="alert"
            className="border-warning/30 bg-warning/10 text-warning flex items-start gap-2 rounded-md border p-2.5 text-xs"
          >
            <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              {unsent === 1
                ? "Há 1 venda feita no PDV sem internet deste aparelho que ainda não foi enviada"
                : `Há ${unsent} vendas feitas no PDV sem internet deste aparelho que ainda não foram enviadas`}{" "}
              para este caixa. Abra o{" "}
              <a href="/pdv" className="font-semibold underline">
                PDV sem internet
              </a>{" "}
              com conexão para enviá-las antes de fechar.
            </span>
          </div>
        )}

        {unsent === 0 && offlinePending.length > 0 && (
          <div
            role="status"
            className="border-warning/30 bg-warning/10 text-warning space-y-1 rounded-md border p-2.5 text-xs"
          >
            <p className="flex items-start gap-2">
              <Smartphone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Aparelhos preparados para este caixa podem ter vendas feitas sem internet ainda não
                enviadas. Se fechar agora, elas entram depois como ajuste pós-fechamento.
              </span>
            </p>
            <ul className="list-disc pl-10">
              {offlinePending.map((d) => (
                <li key={d.deviceId}>
                  {d.deviceName} ({d.userName}):{" "}
                  {d.status === "never"
                    ? "ainda não informou as vendas guardadas"
                    : d.status === "pending"
                      ? `${d.pending} ${d.pending === 1 ? "venda" : "vendas"} a enviar em ${formatStoreDateTime(d.reportedAt!)}`
                      : `sem contato desde ${formatStoreDateTime(d.reportedAt!)}`}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div className="text-destructive bg-destructive/10 border-destructive/20 rounded-md border p-2.5 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <span className="text-foreground block text-xs font-medium">Esperado</span>
              <div className="border-input bg-muted/50 flex h-8 items-center rounded-lg border px-2.5 font-mono text-sm">
                {formatCurrency(expectedCash)}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cash-close-contado" className="text-foreground text-xs font-medium">
                Contado <span className="text-destructive">*</span>
              </Label>
              <MoneyInput
                id="cash-close-contado"
                value={counted}
                onValueChange={setCounted}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <span className="text-foreground block text-xs font-medium">Diferença</span>
              <div
                className={cn(
                  "border-input bg-muted/50 flex h-8 items-center rounded-lg border px-2.5 font-mono text-sm font-semibold",
                  difference === 0 && "text-success",
                  difference !== null && difference > 0 && "text-warning",
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
            <Label htmlFor="cash-close-observacao" className="text-foreground text-xs font-medium">
              Observação{" "}
              {difference !== null && difference !== 0 && (
                <span className="text-destructive">*</span>
              )}
            </Label>
            <Input
              id="cash-close-observacao"
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
            <Button type="submit" disabled={loading || unsent > 0}>
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

/**
 * Bloqueio do fechamento (docs/OFFLINE.md seção 3.3): conta, no banco local deste navegador, as
 * vendas do caixa ainda não gravadas no servidor. O Dexie só é carregado aqui, sob demanda; sem
 * IndexedDB (ou sem uso do PDV offline), não há o que bloquear.
 */
function useUnsentOfflineSales(open: boolean, cashRegisterId: string) {
  const [unsent, setUnsent] = useState(0);
  useEffect(() => {
    if (!open || typeof indexedDB === "undefined") return;
    let active = true;
    import("@/lib/offline/db")
      .then(({ unsentSalesForCashRegister }) => unsentSalesForCashRegister(cashRegisterId))
      .then((count) => active && setUnsent(count))
      .catch((error) => console.error("Não foi possível conferir as vendas offline:", error));
    return () => {
      active = false;
    };
  }, [open, cashRegisterId]);
  return unsent;
}
