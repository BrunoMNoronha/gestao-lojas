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
import { Button } from "@/components/ui/button";
import { Package, Loader2 } from "lucide-react";
import { CategoryData } from "@/actions/categories";
import {
  ProductItem,
  ProductInput,
  createProduct,
  updateProduct,
  UnitType,
} from "@/actions/products";

interface ProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productToEdit?: ProductItem | null;
  categories: CategoryData[];
  onSuccess: () => void;
}

export function ProductDialog({
  open,
  onOpenChange,
  productToEdit,
  categories,
  onSuccess,
}: ProductDialogProps) {
  const [formData, setFormData] = useState<ProductInput>({
    name: "",
    sku: "",
    barcode: "",
    costPrice: 0,
    salePrice: 0,
    unit: "UN",
    currentStock: 0,
    minStock: 0,
    categoryId: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (productToEdit) {
      setFormData({
        id: productToEdit.id,
        name: productToEdit.name,
        sku: productToEdit.sku || "",
        barcode: productToEdit.barcode || "",
        costPrice: productToEdit.costPrice,
        salePrice: productToEdit.salePrice,
        unit: productToEdit.unit,
        currentStock: productToEdit.currentStock,
        minStock: productToEdit.minStock,
        categoryId: productToEdit.categoryId || "",
      });
    } else {
      setFormData({
        name: "",
        sku: "",
        barcode: "",
        costPrice: 0,
        salePrice: 0,
        unit: "UN",
        currentStock: 0,
        minStock: 0,
        categoryId: "",
      });
    }
    setError(null);
  }, [productToEdit, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) {
      setError("O nome do produto é obrigatório.");
      return;
    }

    setLoading(true);
    setError(null);

    const res = productToEdit?.id
      ? await updateProduct(productToEdit.id, formData)
      : await createProduct(formData);

    setLoading(false);

    if (res.success) {
      onOpenChange(false);
      onSuccess();
    } else {
      setError(res.error || "Erro ao salvar produto.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            <DialogTitle>
              {productToEdit ? "Editar Produto" : "Novo Produto"}
            </DialogTitle>
          </div>
          <DialogDescription>
            {productToEdit
              ? "Atualize as informações do produto."
              : "Preencha os campos para cadastrar um novo produto no estoque."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-2.5 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">
              Nome do Produto <span className="text-destructive">*</span>
            </label>
            <Input
              placeholder="Ex: Refrigerante Guaraná 2L"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Código de Barras (EAN)
              </label>
              <Input
                placeholder="7891234567890"
                value={formData.barcode || ""}
                onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                SKU / Código Interno
              </label>
              <Input
                placeholder="REF-001"
                value={formData.sku || ""}
                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Categoria</label>
              <select
                className="w-full h-8 px-2.5 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                value={formData.categoryId || ""}
                onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
              >
                <option value="">Sem Categoria</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Unidade de Medida
              </label>
              <select
                className="w-full h-8 px-2.5 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                value={formData.unit || "UN"}
                onChange={(e) =>
                  setFormData({ ...formData, unit: e.target.value as UnitType })
                }
              >
                <option value="UN">Unidade (UN)</option>
                <option value="KG">Quilograma (KG)</option>
                <option value="LT">Litro (LT)</option>
                <option value="CX">Caixa (CX)</option>
                <option value="M">Metro (M)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Preço de Custo (R$)
              </label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={formData.costPrice || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    costPrice: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Preço de Venda (R$) <span className="text-destructive">*</span>
              </label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={formData.salePrice || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    salePrice: parseFloat(e.target.value) || 0,
                  })
                }
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                {productToEdit ? "Estoque Atual" : "Estoque Inicial"}
              </label>
              <Input
                type="number"
                step="0.001"
                min="0"
                placeholder="0"
                value={formData.currentStock || ""}
                readOnly={!!productToEdit}
                disabled={!!productToEdit}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    currentStock: parseFloat(e.target.value) || 0,
                  })
                }
              />
              {productToEdit && (
                <p className="text-[11px] text-muted-foreground">
                  Altere pelo módulo Estoque (entrada ou ajuste).
                </p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Estoque Mínimo
              </label>
              <Input
                type="number"
                step="0.001"
                placeholder="0"
                value={formData.minStock || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    minStock: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...
                </>
              ) : productToEdit ? (
                "Atualizar Produto"
              ) : (
                "Cadastrar Produto"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
