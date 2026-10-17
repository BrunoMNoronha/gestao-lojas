import { cn } from "@/lib/utils";

export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  align = "center",
  className,
}: {
  /** id do <h2>, para o aria-labelledby da seção. */
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      <p className="text-primary text-sm font-semibold tracking-wide uppercase">{eyebrow}</p>
      <h2
        id={id}
        className="mt-2 text-[clamp(1.75rem,1.25rem+2vw,2.75rem)] leading-tight font-semibold tracking-tight text-balance"
      >
        {title}
      </h2>
      {description && (
        <p className="text-muted-foreground mt-4 text-lg text-pretty">{description}</p>
      )}
    </div>
  );
}
