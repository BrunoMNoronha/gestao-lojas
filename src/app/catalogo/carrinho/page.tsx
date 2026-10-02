import { connection } from "next/server";
import { CatalogCart } from "@/components/catalog-cart";
import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { getCatalogStore } from "@/lib/catalog";

export const metadata = {
  title: "Carrinho",
};

export default async function CatalogCartPage() {
  // Dados da loja vêm do banco: renderiza a cada requisição em vez de prerenderizar no build
  await connection();
  const store = await getCatalogStore();
  if (!store) return <CatalogUnavailable reason="error" />;
  if (!store.enabled) return <CatalogUnavailable reason="disabled" />;

  // O número fica no servidor: o cliente só sabe se o envio está habilitado
  return <CatalogCart canSend={!!store.whatsappNumber} />;
}
