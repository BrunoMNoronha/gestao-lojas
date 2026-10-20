import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AtSign, Mail, MapPin, MessageCircle, Phone, Store } from "lucide-react";
import { CatalogCartButton } from "@/components/catalog-cart-button";
import { getCatalogStore } from "@/lib/catalog";
import { formatWhatsappNumber } from "@/lib/catalog-shared";
import { displayPhone } from "@/lib/masks";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const store = await getCatalogStore();
  const name = store?.name ?? "Catálogo";
  const title = `Catálogo | ${name}`;
  const description = `Confira os produtos de ${name} e envie seu pedido pelo WhatsApp.`;
  return {
    // absolute: sem o sufixo do layout raiz; as páginas do catálogo usam o nome da loja
    title: { absolute: title, template: `%s | ${name}` },
    description,
    openGraph: { type: "website", locale: "pt_BR", siteName: name, title, description },
  };
}

// Área pública (#17): sem sessão, mobile first. Cada página confere se o catálogo está ativo.
export default async function CatalogLayout({ children }: LayoutProps<"/catalogo">) {
  // Dados da loja vêm do banco: renderiza a cada requisição em vez de prerenderizar no build
  await connection();
  const store = await getCatalogStore();
  const active = !!store?.enabled;

  return (
    <div className="bg-muted/30 flex min-h-screen flex-col">
      <header className="bg-background/95 supports-backdrop-filter:bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <Link href="/catalogo" className="flex min-w-0 items-center gap-2 font-semibold">
            <Store className="text-primary size-5 shrink-0" aria-hidden />
            <span className="truncate">{store?.name ?? "Catálogo"}</span>
          </Link>
          {active && <CatalogCartButton />}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 sm:py-6">{children}</main>

      <footer className="bg-background border-t">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm">
          {store && active && (
            <>
              <p className="text-foreground font-medium">{store.name}</p>
              {store.address && (
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> {store.address}
                </p>
              )}
              {store.whatsappNumber ? (
                <p className="flex items-center gap-2">
                  <MessageCircle className="size-4 shrink-0" aria-hidden />
                  WhatsApp {formatWhatsappNumber(store.whatsappNumber)}
                </p>
              ) : (
                store.phone && (
                  <p className="flex items-center gap-2">
                    <Phone className="size-4 shrink-0" aria-hidden /> {displayPhone(store.phone)}
                  </p>
                )
              )}
              {store.email && (
                <p className="flex items-center gap-2 break-all">
                  <Mail className="size-4 shrink-0" aria-hidden /> {store.email}
                </p>
              )}
              {store.instagram && (
                <p className="flex items-center gap-2 break-all">
                  <AtSign className="size-4 shrink-0" aria-hidden /> {store.instagram}
                </p>
              )}
              <p className="pt-2 text-xs">
                Preços e disponibilidade sujeitos a confirmação pela loja.
              </p>
            </>
          )}
          <Link
            href="/login"
            className="hover:text-foreground w-fit text-xs underline-offset-4 hover:underline"
          >
            Área da loja
          </Link>
        </div>
      </footer>
    </div>
  );
}
