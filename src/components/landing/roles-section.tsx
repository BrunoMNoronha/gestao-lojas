import { Check } from "lucide-react";
import { MORE_FEATURES, ROLES } from "./content";
import { SectionHeading } from "./section-heading";

export function RolesSection() {
  return (
    <section
      id="perfis"
      aria-labelledby="perfis-title"
      className="bg-muted/40 scroll-mt-16 border-y py-20 sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          id="perfis-title"
          eyebrow="Perfis de acesso"
          title="Cada pessoa vê só o que precisa"
          description="As permissões são conferidas no servidor em cada tela e ação, não apenas escondidas no menu."
        />
        <ul className="mt-14 grid gap-6 md:grid-cols-3">
          {ROLES.map((role) => {
            const Icon = role.icon;
            return (
              <li
                key={role.title}
                className="bg-card ring-foreground/10 rounded-2xl p-6 ring-1 sm:p-8"
              >
                <span
                  aria-hidden="true"
                  className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-xl"
                >
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-5 text-xl font-semibold">{role.title}</h3>
                <p className="text-muted-foreground mt-1">{role.description}</p>
                <ul className="mt-5 space-y-2.5 text-sm">
                  {role.can.map((item) => (
                    <li key={item} className="flex gap-2.5">
                      <Check aria-hidden="true" className="text-success mt-0.5 size-4 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

export function MoreFeatures() {
  return (
    <section aria-labelledby="recursos-title" className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading id="recursos-title" eyebrow="E mais" title="Os detalhes que poupam tempo" />
        <ul className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {MORE_FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <li key={feature.title} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl"
                >
                  <Icon className="size-5" />
                </span>
                <div>
                  <h3 className="font-semibold">{feature.title}</h3>
                  <p className="text-muted-foreground mt-1 text-sm text-pretty">
                    {feature.description}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
