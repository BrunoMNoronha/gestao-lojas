import { Camera, CircleCheck, Receipt, ShoppingCart } from "lucide-react";
import { BrowserFrame } from "./frames";
import poster from "./screenshots/video-poster.png";
import { SectionHeading } from "./section-heading";

// Gravação real do PDV (pnpm screenshots, tests/screenshots/video.spec.ts). O arquivo fica em
// public/videos/, fora do precache do Service Worker (src/app/serwist/[path]/route.ts).
// Cacheado por 1 ano (next.config.ts): suba o sufixo -vN a cada nova gravação.
const VIDEO_SRC = "/videos/pdv-leitor-codigo-v1.webm";

const STEPS = [
  { icon: Camera, text: "A câmera lê o código de barras do produto" },
  { icon: ShoppingCart, text: "O produto entra no carrinho com preço e quantidade" },
  { icon: CircleCheck, text: "A venda é finalizada no PIX" },
  { icon: Receipt, text: "O comprovante sai na hora, pronto para imprimir" },
];

export function VideoSection() {
  return (
    <section
      id="demonstracao"
      aria-labelledby="video-title"
      className="scroll-mt-16 pt-20 sm:pt-28"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          id="video-title"
          eyebrow="Veja funcionando"
          title="Uma venda do código de barras ao comprovante"
          description="Gravação real da frente de caixa, com a loja de demonstração (a câmera mostra um código de barras de teste)."
        />
        <div className="mt-12 grid items-center gap-10 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
          <BrowserFrame label="Frente de Caixa · Mercado Boa Safra">
            {/* Sem autoplay e com preload="none": só baixa quando a pessoa der play */}
            <video
              controls
              muted
              playsInline
              preload="none"
              poster={poster.src}
              width={1280}
              height={800}
              aria-describedby="video-steps"
              className="bg-muted block aspect-[8/5] h-auto w-full"
            >
              <source src={VIDEO_SRC} type="video/webm" />
              Seu navegador não reproduz este vídeo.{" "}
              <a href={VIDEO_SRC} className="underline">
                Baixe a gravação
              </a>
              .
            </video>
          </BrowserFrame>
          <ol id="video-steps" className="space-y-5">
            {STEPS.map(({ icon: Icon, text }, index) => (
              <li key={text} className="flex items-start gap-4">
                <span
                  aria-hidden="true"
                  className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl"
                >
                  <Icon className="size-5" />
                </span>
                <p className="pt-2">
                  <span className="sr-only">Passo {index + 1}: </span>
                  {text}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
