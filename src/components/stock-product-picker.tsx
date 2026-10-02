"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/option-select";
import { ProductItem } from "@/actions/products";

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

  return (
    <div className="space-y-1">
      <Label htmlFor={selectId} className="text-foreground text-xs font-medium">
        Produto <span className="text-destructive">*</span>
      </Label>
      <Input
        aria-label="Filtrar produtos"
        placeholder="Filtrar por nome, código de barras ou SKU..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
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
