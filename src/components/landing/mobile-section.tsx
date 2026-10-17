import Image from "next/image";
import { PhoneFrame } from "./frames";
import { SCREENSHOTS } from "./screenshots";
import { SectionHeading } from "./section-heading";

const PHONES = [
  { shot: SCREENSHOTS.mobilePdv, caption: "Frente de caixa com barra fixa de finalização" },
  { shot: SCREENSHOTS.mobileProdutos, caption: "Produtos em cartões, com estoque e unidade" },
  { shot: SCREENSHOTS.mobileCatalogo, caption: "Catálogo online que o cliente abre no WhatsApp" },
];

export function MobileSection() {
  return (
    <section id="celular" aria-labelledby="celular-title" className="scroll-mt-16 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          id="celular-title"
          eyebrow="No celular"
          title="A loja no bolso, sem app de loja de aplicativos"
          description="As mesmas telas se ajustam ao celular, com botões grandes para o toque e leitura de código de barras pela câmera. Para usar como app, é só instalar pelo navegador."
        />
        {/* Celular: fila horizontal com rolagem por encaixe; desktop: três colunas */}
        <ul
          aria-label="Telas do sistema no celular"
          tabIndex={0}
          className="focus-visible:ring-ring/50 -mx-4 mt-14 flex snap-x snap-mandatory scroll-px-4 gap-6 overflow-x-auto px-4 pb-4 outline-none focus-visible:ring-3 md:mx-auto md:grid md:max-w-4xl md:grid-cols-3 md:gap-8 md:overflow-visible md:px-0"
        >
          {PHONES.map(({ shot, caption }) => (
            <li
              key={caption}
              className="reveal w-[68vw] max-w-72 shrink-0 snap-center md:w-auto md:max-w-none"
            >
              <figure>
                <PhoneFrame>
                  <Image
                    src={shot.src}
                    alt={shot.alt}
                    placeholder="blur"
                    sizes="(min-width: 768px) 280px, 68vw"
                    className="h-auto w-full"
                  />
                </PhoneFrame>
                <figcaption className="text-muted-foreground mt-4 text-center text-sm">
                  {caption}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
