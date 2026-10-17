import { ChevronDown } from "lucide-react";
import { FAQ } from "./content";
import { SectionHeading } from "./section-heading";

export function FaqSection() {
  return (
    <section
      id="duvidas"
      aria-labelledby="duvidas-title"
      className="bg-muted/40 scroll-mt-16 border-t py-20 sm:py-28"
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <SectionHeading id="duvidas-title" eyebrow="Dúvidas" title="Perguntas frequentes" />
        {/* name="faq": abrir uma pergunta fecha a anterior (acordeão nativo, sem JavaScript) */}
        <div className="bg-card ring-foreground/10 mt-12 divide-y rounded-2xl ring-1">
          {FAQ.map((item, index) => (
            <details
              key={item.question}
              name="faq"
              open={index === 0}
              className="group px-5 sm:px-6"
            >
              <summary className="focus-visible:ring-ring/50 flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-5 font-medium outline-none focus-visible:ring-3 [&::-webkit-details-marker]:hidden">
                {item.question}
                <ChevronDown
                  aria-hidden="true"
                  className="text-muted-foreground size-5 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
                />
              </summary>
              <p className="text-muted-foreground pb-5 text-pretty">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
