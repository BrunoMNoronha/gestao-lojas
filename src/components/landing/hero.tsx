import Image from "next/image";
import { ArrowDown, Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AUDIENCES, HIGHLIGHTS } from "./content";
import { BrowserFrame, PhoneFrame } from "./frames";
import { SCREENSHOTS } from "./screenshots";
import { PrimaryCta } from "./site-header";
import { ThemeImage } from "./theme-image";

export function Hero({ loggedIn }: { loggedIn: boolean }) {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      {/* Fundo: brilho da cor da marca e grade suave, decorativos */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_50%_-5rem,color-mix(in_oklch,var(--primary)_22%,transparent),transparent)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [mask-image:linear-gradient(to_bottom,black,transparent_70%)] bg-[size:3.5rem_3.5rem] opacity-60"
      />

      <div className="mx-auto max-w-6xl px-4 pt-16 pb-10 text-center sm:px-6 sm:pt-24">
        <p className="bg-background/80 text-muted-foreground ring-foreground/10 mx-auto inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full px-4 py-1.5 text-sm ring-1">
          <span className="text-foreground font-medium">ERP e frente de caixa</span>
          <span aria-hidden="true">·</span>
          {AUDIENCES.join(", ")}
        </p>
        <h1
          id="hero-title"
          className="mx-auto mt-6 max-w-4xl text-[clamp(2.25rem,1.4rem+3.6vw,4.25rem)] leading-[1.05] font-semibold tracking-tight text-balance"
        >
          Venda no balcão e controle a loja inteira,{" "}
          <span className="text-primary">mesmo sem internet.</span>
        </h1>
        <p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg text-pretty sm:text-xl">
          PDV rápido, caixa, estoque, fiado, relatórios e catálogo online com pedido pelo WhatsApp,
          num só sistema que roda no computador e no celular.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <PrimaryCta loggedIn={loggedIn} size="xl" />
          <a
            href="#funcionalidades"
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "h-11 gap-2 px-5 text-base",
            )}
          >
            Ver funcionalidades
            <ArrowDown aria-hidden="true" />
          </a>
        </div>
        <ul className="text-muted-foreground mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
          {["Funciona no celular", "App instalável", "Três perfis de acesso"].map((item) => (
            <li key={item} className="flex items-center gap-1.5">
              <Check aria-hidden="true" className="text-success size-4" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24">
        <BrowserFrame label="Painel de Controle · Mercado Boa Safra">
          <ThemeImage
            shot={SCREENSHOTS.dashboard}
            fetchPriority="high"
            sizes="(min-width: 1200px) 1104px, calc(100vw - 2rem)"
            className="h-auto w-full"
          />
        </BrowserFrame>
        <PhoneFrame className="absolute right-0 -bottom-2 hidden w-[13.5rem] sm:right-2 sm:block lg:-right-6 lg:w-60">
          <Image
            src={SCREENSHOTS.mobilePdv.src}
            alt={SCREENSHOTS.mobilePdv.alt}
            placeholder="blur"
            sizes="240px"
            className="h-auto w-full"
          />
        </PhoneFrame>
      </div>

      <div className="bg-muted/40 border-y">
        <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-4 sm:px-6 lg:grid-cols-4">
          {HIGHLIGHTS.map((item) => (
            <div
              key={item.label}
              className="flex flex-col-reverse gap-1 px-2 py-6 text-center sm:px-4"
            >
              <dt className="text-muted-foreground text-sm">{item.label}</dt>
              <dd className="text-lg font-semibold tracking-tight sm:text-xl">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
