import Link from "next/link";
import { Brand, PrimaryCta } from "./site-header";

export function FinalCta({ loggedIn }: { loggedIn: boolean }) {
  return (
    <section aria-labelledby="cta-title" className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="bg-primary text-primary-foreground relative isolate overflow-hidden rounded-3xl px-6 py-14 text-center sm:px-12 sm:py-20">
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-[radial-gradient(40rem_20rem_at_50%_120%,color-mix(in_oklch,white_22%,transparent),transparent)]"
          />
          <h2
            id="cta-title"
            className="mx-auto max-w-2xl text-[clamp(1.75rem,1.25rem+2vw,2.75rem)] leading-tight font-semibold tracking-tight text-balance"
          >
            Pronto para abrir o caixa?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-pretty opacity-90">
            Entre com o seu usuário e comece pelo painel, ou vá direto à frente de caixa.
          </p>
          <div className="mt-8 flex justify-center">
            <PrimaryCta
              loggedIn={loggedIn}
              size="xl"
              className="bg-background text-foreground hover:bg-background/90"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t">
      <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 py-10 text-sm sm:flex-row sm:px-6">
        <Brand className="text-foreground" />
        <nav aria-label="Rodapé">
          <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <li>
              <Link
                href="/login"
                className="hover:text-foreground underline-offset-4 hover:underline"
              >
                Entrar
              </Link>
            </li>
            <li>
              <Link
                href="/catalogo"
                className="hover:text-foreground underline-offset-4 hover:underline"
              >
                Catálogo da loja
              </Link>
            </li>
            <li>
              <a
                href="#funcionalidades"
                className="hover:text-foreground underline-offset-4 hover:underline"
              >
                Funcionalidades
              </a>
            </li>
          </ul>
        </nav>
        <p>Gestão de Lojas ERP/PDV © {year}</p>
      </div>
    </footer>
  );
}
