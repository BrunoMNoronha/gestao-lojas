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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { isHttpUrl } from "@/lib/catalog-shared";
import { ScanBarcodeButton } from "@/components/barcode-scanner-dialog";
import { MoneyInput } from "@/components/money-input";
import { toast } from "sonner";

interface ProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productToEdit?: ProductItem | null;
  // Novo produto já com o código de barras lido pela câmera
  initialBarcode?: string;
  categories: CategoryData[];
  products: ProductItem[];
  onSuccess: () => void;
}

function toFormData(product?: ProductItem | null, initialBarcode?: string): ProductInput {
  if (!product) {
    return {
      name: "",
      sku: "",
      barcode: initialBarcode ?? "",
      costPrice: 0,
      salePrice: 0,
      unit: "UN",
      currentStock: 0,
      minStock: 0,
      categoryId: "",
      showInCatalog: false,
      description: "",
      imageUrl: "",
      containedProductId: null,
      unitsPerBox: null,
    };
  }
  return {
    id: product.id,
    name: product.name,
    sku: product.sku || "",
    barcode: product.barcode || "",
    costPrice: product.costPrice ?? 0,
    salePrice: product.salePrice,
    unit: product.unit,
    currentStock: product.currentStock,
    minStock: product.minStock,
    categoryId: product.categoryId || "",
    showInCatalog: product.showInCatalog,
    description: product.description || "",
    imageUrl: product.imageUrl || "",
    containedProductId: product.containedProductId ?? null,
    unitsPerBox: product.unitsPerBox ?? null,
  };
}

export function ProductDialog({
  open,
  onOpenChange,
  productToEdit,
  initialBarcode,
  categories,
  products,
  onSuccess,
}: ProductDialogProps) {
  const [formData, setFormData] = useState<ProductInput>(() =>
    toFormData(productToEdit, initialBarcode),
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligibleUnits = products.filter(
    (product) =>
      product.unit === "UN" &&
      product.id !== productToEdit?.id &&
      !products.some(
        (box) => box.id !== productToEdit?.id && box.containedProductId === product.id,
      ),
  );
  const originBox = productToEdit
    ? products.find((box) => box.containedProductId === productToEdit.id)
    : undefined;

  // Reinicia o formulário ao abrir ou trocar o produto editado (ajuste durante o render, sem efeito)
  const [syncedWith, setSyncedWith] = useState({ productToEdit, initialBarcode, open });
  if (
    syncedWith.productToEdit !== productToEdit ||
    syncedWith.initialBarcode !== initialBarcode ||
    syncedWith.open !== open
  ) {
    setSyncedWith({ productToEdit, initialBarcode, open });
    setFormData(toFormData(productToEdit, initialBarcode));
    setError(null);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) {
      setError("O nome do produto é obrigatório.");
      return;
    }
    if (
      formData.unit === "CX" &&
      formData.containedProductId &&
      (!Number.isSafeInteger(formData.unitsPerBox) || (formData.unitsPerBox ?? 0) < 2)
    ) {
      setError("Informe uma quantidade inteira de pelo menos 2 unidades por caixa.");
      return;
    }
    const imageUrl = formData.imageUrl?.trim();
    if (imageUrl && !isHttpUrl(imageUrl)) {
      setError("A URL da imagem deve começar com http:// ou https://.");
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
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
                disabled={!!originBox}
                onValueChange={(v) =>
                  setFormData({
                    ...formData,
                    unit: v as UnitType,
                    ...(v !== "CX" ? { containedProductId: null, unitsPerBox: null } : {}),
                  })
                }
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

          {formData.unit === "CX" && (
            <fieldset className="space-y-3 rounded-lg border p-3">
              <legend className="text-foreground px-1 text-xs font-semibold">
                Venda por caixa e avulso
              </legend>
              <div className="space-y-1">
                <Label htmlFor="product-avulso" className="text-xs font-medium">
                  Produto avulso gerado ao abrir a caixa
                </Label>
                <OptionSelect
                  id="product-avulso"
                  value={formData.containedProductId ?? ""}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      containedProductId: value || null,
                      unitsPerBox: value ? (formData.unitsPerBox ?? null) : null,
                    })
                  }
                  options={[
                    { value: "", label: "Sem desmembramento" },
                    ...eligibleUnits.map((product) => ({ value: product.id, label: product.name })),
                  ]}
                />
              </div>
              {formData.containedProductId && (
                <div className="space-y-1">
                  <Label htmlFor="product-unidades-por-caixa" className="text-xs font-medium">
                    Unidades por caixa
                  </Label>
                  <Input
                    id="product-unidades-por-caixa"
                    type="number"
                    inputMode="numeric"
                    min="2"
                    step="1"
                    required
                    value={formData.unitsPerBox ?? ""}
                    onChange={(event) =>
                      setFormData({
                        ...formData,
                        unitsPerBox: event.target.value === "" ? null : Number(event.target.value),
                      })
                    }
                  />
                </div>
              )}
              <p className="text-muted-foreground text-xs">
                Cadastre primeiro o produto avulso como UN. Caixa e avulso têm preços e saldos
                próprios. Ao comprar 3 caixas, registre uma entrada de 3 neste produto.
              </p>
            </fieldset>
          )}
          {formData.unit === "UN" && (
            <p className="text-muted-foreground rounded-lg border p-3 text-xs">
              {originBox
                ? `Recebe ${originBox.unitsPerBox} unidades ao abrir uma caixa de ${originBox.name}.`
                : "Para vender também por caixa, cadastre a caixa como CX e vincule este produto avulso."}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label
                htmlFor="product-preco-de-custo-r"
                className="text-foreground text-xs font-medium"
              >
                Preço de Custo (R$)
              </Label>
              <MoneyInput
                id="product-preco-de-custo-r"
                value={formData.costPrice || null}
                onValueChange={(value) => setFormData({ ...formData, costPrice: value ?? 0 })}
              />
            </div>
            <div className="space-y-1">
              <Label
                htmlFor="product-preco-de-venda-r"
                className="text-foreground text-xs font-medium"
              >
                Preço de Venda (R$) <span className="text-destructive">*</span>
              </Label>
              <MoneyInput
                id="product-preco-de-venda-r"
                value={formData.salePrice || null}
                onValueChange={(value) => setFormData({ ...formData, salePrice: value ?? 0 })}
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

          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="text-foreground px-1 text-xs font-semibold">Catálogo público</legend>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor="product-exibir-no-catalogo" className="text-xs font-medium">
                  Exibir no catálogo
                </Label>
                <p className="text-muted-foreground text-[11px]">
                  O cliente vê nome, preço, unidade e se está disponível, nunca o custo ou o saldo.
                </p>
              </div>
              <Switch
                id="product-exibir-no-catalogo"
                checked={!!formData.showInCatalog}
                onCheckedChange={(checked) => setFormData({ ...formData, showInCatalog: checked })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="product-descricao" className="text-foreground text-xs font-medium">
                Descrição
              </Label>
              <Textarea
                id="product-descricao"
                placeholder="Detalhes exibidos no catálogo (opcional)"
                maxLength={2000}
                value={formData.description || ""}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label
                htmlFor="product-url-da-imagem"
                className="text-foreground text-xs font-medium"
              >
                URL da imagem
              </Label>
              <Input
                id="product-url-da-imagem"
                type="url"
                inputMode="url"
                placeholder="https://..."
                maxLength={2048}
                value={formData.imageUrl || ""}
                onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
              />
            </div>
          </fieldset>

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
