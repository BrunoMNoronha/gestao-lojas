"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ClipboardList, Loader2, ShoppingCart } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { registerCatalogOrderFromLink } from "@/actions/catalog-orders";
import { cartActions, type CartProduct } from "@/lib/catalog-cart";

// Link do pedido do WhatsApp (issue #81), aberto por um usuário logado: gera o pedido por POST
// (Server Action), nunca na renderização, para pré-busca ou prévia de link não criarem pedidos.
// O mesmo link aberto de novo devolve o mesmo pedido.
export function CatalogOrderLinkRegister({ token }: { token: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    registerCatalogOrderFromLink(token)
      .then((result) => {
        if (result.success) {
          router.replace(`/admin/pedidos?status=ALL&pedido=${encodeURIComponent(result.id)}`);
        } else {
          setError(result.error);
        }
      })
      .catch(() => setError("Não foi possível falar com o servidor. Recarregue a página."));
  }, [token, router]);

  if (error) {
    return (
      <EmptyState
        fullPage
        headingLevel="h1"
        icon={AlertTriangle}
        tone="destructive"
        title="Pedido não registrado"
        description={error}
        action={
          <Link href="/admin/pedidos" className={buttonVariants()}>
            Ver pedidos do catálogo
          </Link>
        }
      />
    );
  }
  return (
    <EmptyState
      fullPage
      headingLevel="h1"
      icon={ClipboardList}
      tone="primary"
      title="Registrando o pedido…"
      description={
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Conferindo itens e preços atuais.
        </span>
      }
    />
  );
}

// Link do pedido aberto por um visitante: refaz o carrinho do catálogo com os itens do link que
// continuam disponíveis (o carrinho atual do aparelho é substituído)
export function CatalogOrderLinkCart({
  lines,
  missing,
}: {
  lines: { product: CartProduct; quantity: number }[];
  missing: number;
}) {
  const router = useRouter();
  const applied = useRef(false);
  // Com tudo disponível, segue direto para o carrinho; senão, avisa o que ficou de fora
  const complete = missing === 0 && lines.length > 0;

  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    cartActions.clear();
    for (const { product, quantity } of lines) cartActions.add(product, quantity);
    if (complete) router.replace("/catalogo/carrinho");
  }, [lines, complete, router]);

  if (complete) {
    return (
      <EmptyState
        fullPage
        headingLevel="h1"
        icon={ShoppingCart}
        tone="primary"
        title="Montando o carrinho…"
      />
    );
  }
  return (
    <EmptyState
      fullPage
      headingLevel="h1"
      icon={lines.length > 0 ? ShoppingCart : AlertTriangle}
      tone={lines.length > 0 ? "primary" : "muted"}
      title={lines.length > 0 ? "Carrinho montado" : "Itens indisponíveis"}
      description={
        lines.length > 0
          ? `${missing} ${missing === 1 ? "item do pedido não está" : "itens do pedido não estão"} mais disponíveis no catálogo e ficaram de fora.`
          : "Nenhum item deste pedido está disponível no catálogo agora."
      }
      action={
        <Link
          href={lines.length > 0 ? "/catalogo/carrinho" : "/catalogo"}
          className={buttonVariants()}
        >
          {lines.length > 0 ? "Ver carrinho" : "Ver catálogo"}
        </Link>
      }
    />
  );
}
