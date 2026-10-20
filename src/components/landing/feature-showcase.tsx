import Image from "next/image";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { FEATURES } from "./content";
import { BrowserFrame, PhoneFrame } from "./frames";
import { SectionHeading } from "./section-heading";
import { ThemeImage } from "./theme-image";

export function FeatureShowcase() {
  return (
    <section
      id="funcionalidades"
      aria-labelledby="funcionalidades-title"
      className="scroll-mt-16 py-20 sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          id="funcionalidades-title"
          eyebrow="Funcionalidades"
          title="Tudo o que o balcão e o escritório precisam"
          description="Do primeiro produto cadastrado ao fechamento do caixa, cada tela abaixo é o sistema de verdade, com uma loja de demonstração."
        />

        <div className="mt-16 space-y-24 sm:mt-20 sm:space-y-32">
          {FEATURES.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <article
                key={feature.id}
                aria-labelledby={`feature-${feature.id}`}
                className="reveal grid items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14"
              >
                <div className={cn(index % 2 === 1 && "lg:col-start-2 lg:row-start-1")}>
                  <p className="text-primary flex items-center gap-2 text-sm font-semibold">
                    <span
                      aria-hidden="true"
                      className="bg-primary/10 flex size-8 items-center justify-center rounded-lg"
                    >
                      <Icon className="size-4" />
                    </span>
                    {feature.eyebrow}
                  </p>
                  <h3
                    id={`feature-${feature.id}`}
                    className="mt-4 text-2xl font-semibold tracking-tight text-balance sm:text-3xl"
                  >
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground mt-4 text-lg text-pretty">
                    {feature.description}
                  </p>
                  <ul className="mt-6 space-y-3">
                    {feature.bullets.map((bullet) => (
                      <li key={bullet} className="flex gap-3">
                        <Check aria-hidden="true" className="text-success mt-1 size-4 shrink-0" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div
                  className={cn(
                    "relative",
                    index % 2 === 1 && "lg:col-start-1 lg:row-start-1",
                    feature.phone && "pb-10 sm:pb-0",
                  )}
                >
                  <BrowserFrame label={`${feature.eyebrow} · Mercado Boa Safra`}>
                    <ThemeImage
                      shot={feature.shot}
                      sizes="(min-width: 1200px) 640px, (min-width: 1024px) 55vw, calc(100vw - 2rem)"
                      className="h-auto w-full"
                    />
                  </BrowserFrame>
                  {feature.phone && (
                    <PhoneFrame className="absolute -right-1 -bottom-2 w-32 sm:-right-4 sm:-bottom-8 sm:w-44">
                      <Image
                        src={feature.phone.src}
                        alt={feature.phone.alt}
                        placeholder="blur"
                        sizes="176px"
                        className="h-auto w-full"
                      />
                    </PhoneFrame>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
