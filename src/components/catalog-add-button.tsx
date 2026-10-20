"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cartActions, type CartProduct } from "@/lib/catalog-cart";
import {
  isFractionalUnit,
  parseQuantityInput,
  quantityInputText,
  quantityStep,
  validQuantity,
} from "@/lib/catalog-shared";
import { cn } from "@/lib/utils";

interface CatalogAddButtonProps {
  product: CartProduct & { available: boolean };
  // Detalhe do produto: escolhe a quantidade antes de adicionar
  withQuantity?: boolean;
  className?: string;
}

export function CatalogAddButton({ product, withQuantity, className }: CatalogAddButtonProps) {
  const router = useRouter();
  const [quantityText, setQuantityText] = useState("1");
  const step = quantityStep(product.unit);
  const fractional = isFractionalUnit(product.unit);
  const quantity = validQuantity(product.unit, parseQuantityInput(quantityText));

  if (!product.available) {
    return (
      <Button variant="secondary" disabled className={cn("w-full", className)}>
        Indisponível
      </Button>
    );
  }

  const handleAdd = () => {
    if (quantity === null) {
      toast.error(
        fractional
          ? "Informe uma quantidade maior que zero, com até 3 casas decimais."
          : "Informe uma quantidade inteira maior que zero.",
      );
      return;
    }
    const result = cartActions.add(product, quantity);
    if (result === "full") {
      toast.error("O carrinho chegou ao limite de itens. Envie o pedido ou remova algum item.");
    } else if (result === "invalid") {
      toast.error("Quantidade acima do limite para este item.");
    } else {
      toast.success(
        result === "added" ? "Adicionado ao carrinho." : "Quantidade atualizada no carrinho.",
        {
          description: product.name,
          action: { label: "Ver carrinho", onClick: () => router.push("/catalogo/carrinho") },
        },
      );
    }
  };

  const changeBy = (delta: number) => {
    const next = validQuantity(product.unit, Math.round(((quantity ?? 0) + delta) * 1000) / 1000);
    if (next !== null) setQuantityText(quantityInputText(next));
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {withQuantity && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            aria-label="Diminuir quantidade"
            disabled={quantity === null || quantity <= step}
            onClick={() => changeBy(-step)}
          >
            <Minus />
          </Button>
          <Input
            aria-label={`Quantidade (${product.unit})`}
            inputMode={fractional ? "decimal" : "numeric"}
            value={quantityText}
            onChange={(e) => setQuantityText(e.target.value)}
            aria-invalid={quantity === null}
            className="h-9 w-24 text-center"
          />
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            aria-label="Aumentar quantidade"
            onClick={() => changeBy(step)}
          >
            <Plus />
          </Button>
          <span className="text-muted-foreground text-sm">{product.unit}</span>
        </div>
      )}
      <Button size="lg" className="w-full" onClick={handleAdd}>
        <ShoppingCart /> Adicionar
      </Button>
    </div>
  );
}
