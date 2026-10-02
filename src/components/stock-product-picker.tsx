"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/option-select";
import { ProductItem } from "@/actions/products";
import { ScanBarcodeButton } from "@/components/barcode-scanner-dialog";
import { toast } from "sonner";

interface ProductPickerProps {
  products: ProductItem[];
  value: string;
  onChange: (productId: string) => void;
}

// Seleção de produto com filtro por nome, código de barras ou SKU
export function ProductPicker({ products, value, onChange }: ProductPickerProps) {
  const selectId = "stock-product-picker";
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = q
    ? products.filter(
        (p) =>
          p.id === value ||
          p.name.toLowerCase().includes(q) ||
          p.barcode?.toLowerCase().includes(q) ||
          p.sku?.toLowerCase().includes(q),
      )
    : products;

  // Leitura pela câmera: filtra pelo código e já seleciona o produto quando o código/SKU bate exato
  const handleScannedCode = (code: string) => {
    setQuery(code);
    const c = code.toLowerCase();
    const exact = products.find(
      (p) => p.barcode?.toLowerCase() === c || p.sku?.toLowerCase() === c,
    );
    if (exact) {
      onChange(exact.id);
      toast.success(`${exact.name} selecionado (${code}).`);
    } else {
      toast.error(`Nenhum produto com o código ${code}.`);
    }
  };

  return (
    <div className="space-y-1">
      <Label htmlFor={selectId} className="text-foreground text-xs font-medium">
        Produto <span className="text-destructive">*</span>
      </Label>
      <div className="flex gap-2">
        <Input
          aria-label="Filtrar produtos"
          placeholder="Filtrar por nome, código de barras ou SKU..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ScanBarcodeButton
          size="icon-sm"
          className="size-8"
          label="Ler código do produto pela câmera"
          onDetected={handleScannedCode}
        />
      </div>
      <OptionSelect
        id={selectId}
        value={value}
        onValueChange={onChange}
        placeholder="Selecione um produto"
        required
        options={filtered.map((p) => ({ value: p.id, label: `${p.name} (${p.unit})` }))}
      />
    </div>
  );
}
