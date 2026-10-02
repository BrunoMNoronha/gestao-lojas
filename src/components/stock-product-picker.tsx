"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ProductItem } from "@/actions/products";

interface ProductPickerProps {
  products: ProductItem[];
  value: string;
  onChange: (productId: string) => void;
}

// Seleção de produto com filtro por nome, código de barras ou SKU
export function ProductPicker({ products, value, onChange }: ProductPickerProps) {
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
      <label className="text-foreground text-xs font-medium">
        Produto <span className="text-destructive">*</span>
      </label>
      <Input
        placeholder="Filtrar por nome, código de barras ou SKU..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <select
        className="border-input bg-background focus:ring-ring h-8 w-full rounded-lg border px-2.5 text-sm focus:ring-2 focus:outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      >
        <option value="">Selecione um produto</option>
        {filtered.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.unit})
          </option>
        ))}
      </select>
    </div>
  );
}
