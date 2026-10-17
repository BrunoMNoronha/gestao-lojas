"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Undo2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { reverseSaleAction, type SaleDetail } from "@/actions/sales";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments";
import { formatCurrency } from "@/lib/utils";

const REASON_MIN = 3;
const REASON_MAX = 500;

interface SaleReversalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale: SaleDetail;
  onReversed: () => void;
}

// O que o estorno vai fazer, na mesma regra de src/lib/reverse-sale.ts
function effects(sale: SaleDetail): string[] {
  const lines = [
    `${sale.items.length} ${sale.items.length === 1 ? "item volta" : "itens voltam"} ao estoque.`,
  ];
  const total = formatCurrency(sale.total);

  if (sale.paymentMethod === "MONEY") {
    if (sale.cashRegister && !sale.cashRegister.closedAt) {
      lines.push(
        `Devolva ${total} em dinheiro pela gaveta do caixa de ${sale.cashRegister.userName}; a venda sai do esperado desse caixa.`,
      );
    } else {
      lines.push(`O caixa da venda já foi fechado: ${total} sai como sangria do seu caixa aberto.`);
    }
  } else if (sale.paymentMethod === "ON_ACCOUNT") {
    lines.push("O título do Fiado é cancelado e deixa de contar como dívida do cliente.");
    const payments = sale.receivable?.payments ?? [];
    const cash = payments.filter((p) => p.method === "MONEY").reduce((s, p) => s + p.amount, 0);
    const other = payments.filter((p) => p.method !== "MONEY").reduce((s, p) => s + p.amount, 0);
    if (cash > 0) {
      lines.push(
        `Recebimentos em dinheiro (${formatCurrency(cash)}) saem como sangria do seu caixa aberto.`,
      );
    }
    if (other > 0) {
      lines.push(
        `Recebimentos por outros meios (${formatCurrency(other)}) devem ser devolvidos fora do sistema.`,
      );
    }
  } else {
    lines.push(
      `Devolva ${total} ao cliente pelo mesmo meio (${PAYMENT_METHOD_LABELS[sale.paymentMethod]}), fora do sistema.`,
    );
  }

  lines.push("A venda continua no relatório, marcada como estornada, e sai de todos os totais.");
  return lines;
}

// O componente pai troca a `key` a cada abertura, reiniciando o formulário
export function SaleReversalDialog({
  open,
  onOpenChange,
  sale,
  onReversed,
}: SaleReversalDialogProps) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN) {
      setError(`Informe o motivo (pelo menos ${REASON_MIN} caracteres).`);
      return;
    }

    setLoading(true);
    setError(null);
    const res = await reverseSaleAction({ saleId: sale.id, reason: trimmed });
    setLoading(false);

    if (!res.success) {
      setError(res.error || "Erro ao estornar a venda.");
      return;
    }
    toast.success(`Venda #${res.data.code} estornada.`);
    onOpenChange(false);
    onReversed();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Undo2 className="text-destructive h-5 w-5" />
            <DialogTitle>Estornar venda #{sale.code}</DialogTitle>
          </div>
          <DialogDescription>
            Cancela a venda inteira ({formatCurrency(sale.total)}). Não pode ser desfeito.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="text-destructive bg-destructive/10 border-destructive/20 rounded-md border p-2.5 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
            {effects(sale).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <div className="space-y-1">
            <Label htmlFor="sale-reversal-motivo" className="text-foreground text-xs font-medium">
              Motivo <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="sale-reversal-motivo"
              placeholder="Ex: Cliente desistiu da compra"
              maxLength={REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              autoFocus
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Estornando...
                </>
              ) : (
                "Estornar venda"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
