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
import { ClipboardCheck, Loader2 } from "lucide-react";
import { ProductItem } from "@/actions/products";
import { adjustStock } from "@/actions/stock";
import { cn } from "@/lib/utils";
import { formatQuantity, isIntegerUnit } from "@/lib/stock";
import { ProductPicker } from "@/components/stock-product-picker";
import { Label } from "@/components/ui/label";

interface StockAdjustDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: ProductItem[];
  initialProductId?: string | null;
  onSuccess: () => void;
}

const parseDecimal = (value: string) => parseFloat(value.replace(",", "."));

export function StockAdjustDialog({
  open,
  onOpenChange,
  products,
  initialProductId,
  onSuccess,
}: StockAdjustDialogProps) {
  // Estado inicial lido na montagem: o componente pai troca a `key` a cada abertura
  const [productId, setProductId] = useState(initialProductId || "");
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [chosenProduct, setChosenProduct] = useState<ProductItem | null>(null);
  const product =
    chosenProduct?.id === productId
      ? chosenProduct
      : (products.find((p) => p.id === productId) ?? null);
  const countedValue = counted.trim() ? parseDecimal(counted) : Number.NaN;
  const delta =
    product && Number.isFinite(countedValue)
      ? Math.round((countedValue - product.currentStock) * 1000) / 1000
      : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) {
      setError("Selecione o produto a ajustar.");
      return;
    }
    if (!Number.isFinite(countedValue) || countedValue < 0) {
      setError("O saldo contado não pode ser negativo.");
      return;
    }
    if (isIntegerUnit(product.unit) && !Number.isInteger(countedValue)) {
      setError(`"${product.name}" aceita apenas quantidades inteiras (${product.unit}).`);
      return;
    }
    if (delta === 0) {
      setError("O saldo contado é igual ao saldo atual. Nada a ajustar.");
      return;
    }
    if (!reason.trim()) {
      setError("Informe o motivo do ajuste.");
      return;
    }

    setLoading(true);
    setError(null);

    const res = await adjustStock({
      productId: product.id,
      countedQuantity: countedValue,
      reason: reason.trim(),
    });

    setLoading(false);

    if (res.success) {
      onOpenChange(false);
      onSuccess();
    } else {
      setError(res.error || "Erro ao ajustar o estoque.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="text-primary h-5 w-5" />
            <DialogTitle>Ajustar Estoque</DialogTitle>
          </div>
          <DialogDescription>
            Informe o saldo contado fisicamente. A diferença é registrada como ajuste.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="text-destructive bg-destructive/10 border-destructive/20 rounded-md border p-2.5 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <ProductPicker
            products={products}
            value={productId}
            onChange={setProductId}
            onSelect={setChosenProduct}
          />

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <span className="text-foreground block text-xs font-medium">Saldo Atual</span>
              <div className="border-input bg-muted/50 flex h-8 items-center rounded-lg border px-2.5 font-mono text-sm">
                {product
                  ? `${formatQuantity(product.currentStock, product.unit)} ${product.unit}`
                  : "-"}
              </div>
            </div>
            <div className="space-y-1">
              <Label
                htmlFor="stock-adjust-saldo-contado"
                className="text-foreground text-xs font-medium"
              >
                Saldo Contado <span className="text-destructive">*</span>
              </Label>
              <Input
                id="stock-adjust-saldo-contado"
                type="number"
                step={product && isIntegerUnit(product.unit) ? "1" : "0.001"}
                min="0"
                placeholder="0"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <span className="text-foreground block text-xs font-medium">Diferença</span>
              <div
                className={cn(
                  "border-input bg-muted/50 flex h-8 items-center rounded-lg border px-2.5 font-mono text-sm font-semibold",
                  delta !== null && delta > 0 && "text-success",
                  delta !== null && delta < 0 && "text-destructive",
                )}
              >
                {product && delta !== null
                  ? `${delta > 0 ? "+" : ""}${formatQuantity(delta, product.unit)}`
                  : "-"}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="stock-adjust-motivo" className="text-foreground text-xs font-medium">
              Motivo <span className="text-destructive">*</span>
            </Label>
            <Input
              id="stock-adjust-motivo"
              placeholder="Ex: Inventário mensal, avaria, perda, vencimento"
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
              ) : (
                "Confirmar Ajuste"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
