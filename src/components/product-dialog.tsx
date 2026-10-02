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
import { OptionSelect } from "@/components/option-select";
import { Label } from "@/components/ui/label";
import { ScanBarcodeButton } from "@/components/barcode-scanner-dialog";
import { toast } from "sonner";

interface ProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productToEdit?: ProductItem | null;
  // Novo produto já com o código de barras lido pela câmera
  initialBarcode?: string;
  categories: CategoryData[];
  onSuccess: () => void;
}

export function ProductDialog({
  open,
  onOpenChange,
  productToEdit,
  initialBarcode,
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
        barcode: initialBarcode ?? "",
        costPrice: 0,
        salePrice: 0,
        unit: "UN",
        currentStock: 0,
        minStock: 0,
        categoryId: "",
      });
    }
    setError(null);
  }, [productToEdit, initialBarcode, open]);

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
            <Package className="text-primary h-5 w-5" />
            <DialogTitle>{productToEdit ? "Editar Produto" : "Novo Produto"}</DialogTitle>
          </div>
          <DialogDescription>
            {productToEdit
              ? "Atualize as informações do produto."
              : "Preencha os campos para cadastrar um novo produto no estoque."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="text-destructive bg-destructive/10 border-destructive/20 rounded-md border p-2.5 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label
              htmlFor="product-nome-do-produto"
              className="text-foreground text-xs font-medium"
            >
              Nome do Produto <span className="text-destructive">*</span>
            </Label>
            <Input
              id="product-nome-do-produto"
              placeholder="Ex: Refrigerante Guaraná 2L"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label
                htmlFor="product-codigo-de-barras-ean"
                className="text-foreground text-xs font-medium"
              >
                Código de Barras (EAN)
              </Label>
              <div className="flex gap-2">
                <Input
                  id="product-codigo-de-barras-ean"
                  placeholder="7891234567890"
                  value={formData.barcode || ""}
                  onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                />
                <ScanBarcodeButton
                  size="icon-sm"
                  className="size-8"
                  label="Ler código de barras pela câmera"
                  onDetected={(code) => {
                    setFormData((prev) => ({ ...prev, barcode: code }));
                    toast.success(`Código ${code} lido.`);
                  }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label
                htmlFor="product-sku-codigo-interno"
                className="text-foreground text-xs font-medium"
              >
                SKU / Código Interno
              </Label>
              <Input
                id="product-sku-codigo-interno"
                placeholder="REF-001"
                value={formData.sku || ""}
                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="product-categoria" className="text-foreground text-xs font-medium">
                Categoria
              </Label>
              <OptionSelect
                id="product-categoria"
                value={formData.categoryId || ""}
                onValueChange={(v) => setFormData({ ...formData, categoryId: v })}
                options={[
                  { value: "", label: "Sem Categoria" },
                  ...categories.map((cat) => ({ value: cat.id, label: cat.name })),
                ]}
              />
            </div>
            <div className="space-y-1">
              <Label
                htmlFor="product-unidade-de-medida"
                className="text-foreground text-xs font-medium"
              >
                Unidade de Medida
              </Label>
              <OptionSelect
                id="product-unidade-de-medida"
                value={formData.unit || "UN"}
                onValueChange={(v) => setFormData({ ...formData, unit: v as UnitType })}
                options={[
                  { value: "UN", label: "Unidade (UN)" },
                  { value: "KG", label: "Quilograma (KG)" },
                  { value: "LT", label: "Litro (LT)" },
                  { value: "CX", label: "Caixa (CX)" },
                  { value: "M", label: "Metro (M)" },
                ]}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label
                htmlFor="product-preco-de-custo-r"
                className="text-foreground text-xs font-medium"
              >
                Preço de Custo (R$)
              </Label>
              <Input
                id="product-preco-de-custo-r"
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
              <Label
                htmlFor="product-preco-de-venda-r"
                className="text-foreground text-xs font-medium"
              >
                Preço de Venda (R$) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="product-preco-de-venda-r"
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
              <Label htmlFor="product-campo" className="text-foreground text-xs font-medium">
                {productToEdit ? "Estoque Atual" : "Estoque Inicial"}
              </Label>
              <Input
                id="product-campo"
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
                <p className="text-muted-foreground text-[11px]">
                  Altere pelo módulo Estoque (entrada ou ajuste).
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label
                htmlFor="product-estoque-minimo"
                className="text-foreground text-xs font-medium"
              >
                Estoque Mínimo
              </Label>
              <Input
                id="product-estoque-minimo"
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando...
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
