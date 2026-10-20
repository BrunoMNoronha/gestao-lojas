import Image from "next/image";
import { WifiOff } from "lucide-react";
import { OFFLINE_STEPS } from "./content";
import { BrowserFrame } from "./frames";
import { SCREENSHOTS } from "./screenshots";

// Faixa escura nos dois temas: o destaque da página é o PDV que não para sem internet.
export function OfflineSection() {
  return (
    <section
      id="offline"
      aria-labelledby="offline-title"
      className="scroll-mt-16 bg-[oklch(0.2_0.03_215)] py-20 text-[oklch(0.97_0.005_200)] sm:py-28"
    >
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold tracking-wide text-[oklch(0.8_0.11_190)] uppercase">
            <WifiOff aria-hidden="true" className="size-4" />
            PDV sem internet
          </p>
          <h2
            id="offline-title"
            className="mt-3 text-[clamp(1.75rem,1.25rem+2vw,2.75rem)] leading-tight font-semibold tracking-tight text-balance"
          >
            A internet caiu. A fila do caixa, não.
          </h2>
          <p className="mt-4 text-lg text-pretty text-[oklch(0.82_0.01_220)]">
            O PDV instalável continua vendendo com os dados guardados no aparelho e envia tudo ao
            servidor quando a conexão volta, sem venda perdida nem digitação dobrada.
          </p>
          <ol className="mt-10 space-y-8">
            {OFFLINE_STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[oklch(0.75_0.11_190)] font-semibold text-[oklch(0.2_0.03_200)]"
                >
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-lg font-semibold">{step.title}</h3>
                  <p className="mt-1 text-pretty text-[oklch(0.82_0.01_220)]">{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="reveal">
          <BrowserFrame label="PDV sem internet · Mercado Boa Safra" className="ring-white/15">
            <Image
              src={SCREENSHOTS.pdvOffline.src}
              alt={SCREENSHOTS.pdvOffline.alt}
              placeholder="blur"
              sizes="(min-width: 1200px) 640px, (min-width: 1024px) 55vw, calc(100vw - 2rem)"
              className="h-auto w-full"
            />
          </BrowserFrame>
        </div>
      </div>
    </section>
  );
}
