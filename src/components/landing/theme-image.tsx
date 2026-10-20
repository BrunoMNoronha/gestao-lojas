import Image, { type ImageProps } from "next/image";
import { cn } from "@/lib/utils";
import type { Screenshot } from "./screenshots";

type ThemeImageProps = Omit<ImageProps, "src" | "alt"> & { shot: Screenshot };

/**
 * Captura que acompanha o tema (classe .dark do next-themes): as duas versões ficam no HTML e o
 * CSS mostra uma. Sem `preload`/`loading="eager"`, para o navegador só baixar a visível; a
 * prioridade da imagem principal vem de `fetchPriority` (doc do next/image, imagens por tema).
 */
export function ThemeImage({ shot, className, ...props }: ThemeImageProps) {
  if (!shot.dark) {
    return (
      <Image {...props} src={shot.src} alt={shot.alt} placeholder="blur" className={className} />
    );
  }
  return (
    <>
      <Image
        {...props}
        src={shot.src}
        alt={shot.alt}
        placeholder="blur"
        className={cn(className, "dark:hidden")}
      />
      <Image
        {...props}
        src={shot.dark}
        alt={shot.alt}
        placeholder="blur"
        className={cn(className, "hidden dark:block")}
      />
    </>
  );
}
