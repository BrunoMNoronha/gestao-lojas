"use client";

import { useState } from "react";
import { ProductLookup } from "@/components/async-lookup";
import { getProductOptions } from "@/actions/browse";
import { Label } from "@/components/ui/label";
import { ProductItem } from "@/actions/products";
import { ScanBarcodeButton } from "@/components/barcode-scanner-dialog";
import { toast } from "sonner";

interface ProductPickerProps {
  products: ProductItem[];
  value: string;
  onChange: (productId: string) => void;
  onSelect?: (item: ProductItem | null) => void;
}

// Seleção de produto com filtro por nome, código de barras ou SKU
export function ProductPicker({ products, value, onChange, onSelect }: ProductPickerProps) {
  const [selected, setSelected] = useState<ProductItem | null>(
    products.find((p) => p.id === value) ?? null,
  );
  const choose = (item: ProductItem | null) => {
    setSelected(item);
    onSelect?.(item);
    onChange(item?.id ?? "");
  };
  const handleScannedCode = async (code: string) => {
    const rows = await getProductOptions(code, undefined, undefined, true);
    const exact = rows.find(
      (p) =>
        p.barcode?.toLowerCase() === code.toLowerCase() ||
        p.sku?.toLowerCase() === code.toLowerCase(),
    );
    if (exact) {
      choose(exact);
      toast.success(`${exact.name} selecionado (${code}).`);
    } else toast.error(`Nenhum produto com o código ${code}.`);
  };
  return (
    <div className="space-y-2">
      <Label>Produto *</Label>
      <ProductLookup
        label="Produto"
        value={value}
        selected={selected}
        onSelect={choose}
        emptyLabel="Selecione um produto"
      />
      <ScanBarcodeButton label="Ler código do produto pela câmera" onDetected={handleScannedCode} />
    </div>
  );
}
