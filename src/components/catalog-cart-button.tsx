"use client";

import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { useCart } from "@/lib/catalog-cart";
import { cn } from "@/lib/utils";

// Atalho do cabeçalho do catálogo para o carrinho, com a quantidade de itens
export function CatalogCartButton() {
  const cart = useCart();
  const count = cart.length;

  return (
    <Link
      href="/catalogo/carrinho"
      className={cn(buttonVariants({ variant: "outline", size: "lg" }), "relative")}
      aria-label={
        count > 0 ? `Carrinho com ${count} ${count === 1 ? "item" : "itens"}` : "Carrinho vazio"
      }
    >
      <ShoppingCart />
      <span className="hidden sm:inline">Carrinho</span>
      {count > 0 && (
        <span className="bg-primary text-primary-foreground absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold">
          {count}
        </span>
      )}
    </Link>
  );
}
