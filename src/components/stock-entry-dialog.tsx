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
import { PackagePlus, Loader2 } from "lucide-react";
import { ProductItem } from "@/actions/products";
import { SupplierItem } from "@/actions/suppliers";
import { registerStockEntry } from "@/actions/stock";
import { formatQuantity, isIntegerUnit } from "@/lib/stock";
import { ProductPicker } from "@/components/stock-product-picker";

interface StockEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: ProductItem[];
  suppliers: SupplierItem[];
  initialProductId?: string | null;
  onSuccess: () => void;
}

const parseDecimal = (value: string) => parseFloat(value.replace(",", "."));

export function StockEntryDialog({
  open,
  onOpenChange,
  products,
  suppliers,
  initialProductId,
  onSuccess,
}: StockEntryDialogProps) {
  // Estado inicial lido na montagem: o componente pai troca a `key` a cada abertura
  const [productId, setProductId] = useState(initialProductId || "");
  const [quantity, setQuantity] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reason, setReason] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const product = products.find((p) => p.id === productId) ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) {
      setError("Selecione o produto da entrada.");
      return;
    }
    const qty = parseDecimal(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("A quantidade da entrada deve ser maior que zero.");
      return;
    }
    if (isIntegerUnit(product.unit) && !Number.isInteger(qty)) {
      setError(`"${product.name}" aceita apenas quantidades inteiras (${product.unit}).`);
      return;
    }
    const cost = unitCost.trim() ? parseDecimal(unitCost) : null;
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
      setError("O custo unitário não pode ser negativo.");
      return;
    }

    setLoading(true);
    setError(null);

    const res = await registerStockEntry({
      productId: product.id,
      quantity: qty,
      supplierId: supplierId || null,
      unitCost: cost,
      reason: reason.trim() || null,
    });

    setLoading(false);

    if (res.success) {
      onOpenChange(false);
      onSuccess();
    } else {
      setError(res.error || "Erro ao registrar a entrada.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <PackagePlus className="text-primary h-5 w-5" />
            <DialogTitle>Registrar Entrada</DialogTitle>
          </div>
          <DialogDescription>
            Lance a chegada de mercadorias (compra de fornecedor, reposição etc.).
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="text-destructive bg-destructive/10 border-destructive/20 rounded-md border p-2.5 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <ProductPicker products={products} value={productId} onChange={setProductId} />

          {product && (
            <p className="text-muted-foreground text-xs">
              Saldo atual:{" "}
              <span className="text-foreground font-mono font-medium">
                {formatQuantity(product.currentStock, product.unit)} {product.unit}
              </span>
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-foreground text-xs font-medium">
                Quantidade <span className="text-destructive">*</span>
              </label>
              <Input
                type="number"
                step={product && isIntegerUnit(product.unit) ? "1" : "0.001"}
                min="0"
                placeholder="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-foreground text-xs font-medium">Custo Unitário (R$)</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Opcional"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-foreground text-xs font-medium">Fornecedor</label>
            <select
              className="border-input bg-background focus:ring-ring h-8 w-full rounded-lg border px-2.5 text-sm focus:ring-2 focus:outline-none"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">Sem fornecedor</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-foreground text-xs font-medium">Observação</label>
            <Input
              placeholder="Ex: NF 1234"
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
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
                "Registrar Entrada"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
