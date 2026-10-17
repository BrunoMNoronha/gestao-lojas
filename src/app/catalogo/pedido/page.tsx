import { connection } from "next/server";
import { Link2Off } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { CatalogOrderLinkCart, CatalogOrderLinkRegister } from "@/components/catalog-order-link";
import { getSessionUser } from "@/lib/authz";
import { getCatalogProduct, getCatalogStore } from "@/lib/catalog";
import { decodeOrderLink, validQuantity } from "@/lib/catalog-shared";
import { can } from "@/lib/permissions";

// Link do pedido enviado pelo WhatsApp (issue #81). Usuário logado com acesso ao PDV: gera o
// pedido no sistema. Visitante: refaz o carrinho. Nada é gravado na renderização.
export const metadata = {
  title: "Pedido do catálogo",
  robots: { index: false, follow: false },
};

export default async function CatalogOrderLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  // Sessão e estoque mudam a cada acesso: nada de prerenderizar
  await connection();
  const { p } = await searchParams;
  const link = decodeOrderLink(p);
  if (!link || !p) {
    return (
      <EmptyState
        fullPage
        headingLevel="h1"
        icon={Link2Off}
        title="Link de pedido inválido"
        description="O link está incompleto ou foi alterado. Peça à loja ou ao cliente um link novo."
      />
    );
  }

  const user = await getSessionUser().catch(() => null);
  if (user && can(user.role, "pdv.use")) return <CatalogOrderLinkRegister token={p} />;

  const store = await getCatalogStore();
  if (!store) return <CatalogUnavailable reason="error" />;
  if (!store.enabled) return <CatalogUnavailable reason="disabled" />;

  // Só o que o catálogo público já mostra: produto visível, com preço e unidade atuais
  const products = await Promise.all(link.items.map((item) => getCatalogProduct(item.productId)));
  const lines = link.items.flatMap((item, index) => {
    const product = products[index];
    if (!product || !product.available) return [];
    const quantity = validQuantity(product.unit, item.quantity);
    if (quantity === null) return [];
    return [
      {
        product: {
          id: product.id,
          name: product.name,
          price: product.price,
          unit: product.unit,
          imageUrl: product.imageUrl,
        },
        quantity,
      },
    ];
  });

  return <CatalogOrderLinkCart lines={lines} missing={link.items.length - lines.length} />;
}
