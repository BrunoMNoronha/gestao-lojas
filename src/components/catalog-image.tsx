"use client";

import { useState } from "react";
import { ImageOff, Package } from "lucide-react";
import { cn } from "@/lib/utils";

interface CatalogImageProps {
  src: string | null;
  alt: string;
  className?: string;
  // Imagem principal da página (detalhe): carrega sem lazy
  priority?: boolean;
}

// Imagem de produto por URL externa (sem upload nem otimização do Next): <img> nativo com lazy
// loading e placeholder quando não há imagem ou o endereço falha.
export function CatalogImage({ src, alt, className, priority }: CatalogImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    const Icon = src ? ImageOff : Package;
    return (
      <div
        className={cn("bg-muted text-muted-foreground flex items-center justify-center", className)}
        role="img"
        aria-label={src ? `Imagem indisponível: ${alt}` : `Sem imagem: ${alt}`}
      >
        <Icon className="size-1/4 max-h-12 max-w-12" aria-hidden />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- URL externa cadastrada pela loja
    <img
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
      // A imagem pode falhar antes da hidratação (sem disparar onError no React)
      ref={(img) => {
        if (img?.complete && img.naturalWidth === 0) setFailedSrc(src);
      }}
      className={cn("bg-muted object-cover", className)}
    />
  );
}
