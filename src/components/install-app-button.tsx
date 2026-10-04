"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  detectInstallPlatform,
  promptInstall,
  useInstallState,
  type InstallPlatform,
} from "@/lib/pwa-install";
import { cn } from "@/lib/utils";

// Oferta de instalação do app (issue #61), no menu do painel e no cabeçalho do /pdv. Com a janela
// do navegador disponível, o botão a abre; sem ela, o botão vira "Como instalar" e mostra a
// orientação da plataforma, sem prometer uma janela que não existe. Some no app já instalado.
// Instalar não prepara o PDV para uso sem internet nem garante o armazenamento (#59).

interface InstallAppButtonProps {
  // "menu": item do menu lateral; "pdv": botão pequeno do cabeçalho do /pdv
  variant: "menu" | "pdv";
}

export function InstallAppButton({ variant }: InstallAppButtonProps) {
  const state = useInstallState();
  const [helpOpen, setHelpOpen] = useState(false);

  if (state.standalone || state.installed) return null;

  const onClick = async () => {
    if (!state.canPrompt) {
      setHelpOpen(true);
      return;
    }
    const result = await promptInstall();
    if (result === "accepted") {
      toast.info("Instalação iniciada pelo navegador. O ícone do app aparece quando ela terminar.");
    } else if (result === "error" || result === "unavailable") {
      toast.error("O navegador não abriu a instalação. Veja como instalar pelo menu do navegador.");
      setHelpOpen(true);
    }
    // "dismissed": o usuário fechou a janela; nada a fazer, e ela não abre de novo sozinha
  };

  const label = state.canPrompt ? "Instalar app Gestão Lojas" : "Como instalar o app";
  const Icon = state.canPrompt ? Download : Info;

  return (
    <>
      {variant === "menu" ? (
        <Button
          variant="ghost"
          className="text-muted-foreground w-full justify-start gap-3"
          onClick={onClick}
          disabled={state.prompting}
        >
          <Icon />
          {label}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={onClick}
          disabled={state.prompting}
        >
          <Icon className="h-4 w-4" />
          {label}
        </Button>
      )}
      <InstallHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}

function InstallHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Detectado ao abrir, no navegador (o user agent não existe no servidor)
  const platform: InstallPlatform | null = open
    ? detectInstallPlatform(navigator.userAgent, navigator.maxTouchPoints)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Como instalar o app Gestão Lojas</DialogTitle>
          <DialogDescription>
            O app abre em janela própria, com ícone na tela inicial ou na área de trabalho.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm leading-relaxed">
          {platform && <PlatformSteps platform={platform} />}
          <p className="text-muted-foreground">
            Os nomes das opções mudam conforme a versão do navegador. Se o app já estiver instalado,
            abra-o pelo ícone.
          </p>
          <p className="bg-muted/50 rounded-md border p-3">
            Instalar não prepara o PDV para vender sem internet. Para isso, abra a{" "}
            <strong>Frente de Caixa</strong> com conexão e use{" "}
            <strong>Preparar este aparelho</strong>.
          </p>
        </div>

        <DialogFooter>
          <DialogClose render={<Button />}>Entendi</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className={cn("list-decimal space-y-1 pl-5")}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  );
}

function PlatformSteps({ platform }: { platform: InstallPlatform }) {
  switch (platform) {
    case "ios":
      return (
        <>
          <p className="font-medium">iPhone ou iPad (Safari)</p>
          <Steps
            items={[
              <>
                Toque em <strong>Compartilhar</strong> (quadrado com seta para cima).
              </>,
              <>
                Escolha <strong>Adicionar à Tela de Início</strong> e confirme em{" "}
                <strong>Adicionar</strong>.
              </>,
            ]}
          />
          <p>
            No iPhone e no iPad o app funciona com internet. O PDV sem internet é suportado só no
            Chrome e no Edge, em computador e Android.
          </p>
        </>
      );
    case "android":
      return (
        <>
          <p className="font-medium">Android (Chrome ou Edge)</p>
          <Steps
            items={[
              <>
                Abra o menu do navegador (<strong>⋮</strong> ou <strong>…</strong>).
              </>,
              <>
                Toque em <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>{" "}
                e confirme.
              </>,
            ]}
          />
        </>
      );
    case "desktop-chromium":
      return (
        <>
          <p className="font-medium">Computador (Chrome ou Edge)</p>
          <Steps
            items={[
              <>
                Clique no ícone de instalação na barra de endereço, se aparecer, ou abra o menu do
                navegador (<strong>⋮</strong> ou <strong>…</strong>).
              </>,
              <>
                No Chrome:{" "}
                <strong>Transmitir, salvar e compartilhar → Instalar página como app</strong>. No
                Edge: <strong>Aplicativos → Instalar este site como um aplicativo</strong>.
              </>,
            ]}
          />
        </>
      );
    case "mac-safari":
      return (
        <>
          <p className="font-medium">Mac (Safari)</p>
          <Steps
            items={[
              <>
                No menu <strong>Arquivo</strong>, escolha <strong>Adicionar ao Dock</strong>.
              </>,
            ]}
          />
          <p>O PDV sem internet é suportado só no Chrome e no Edge.</p>
        </>
      );
    case "firefox":
      return (
        <p>
          O Firefox para computador não instala sites como app. Use o Chrome ou o Edge para
          instalar.
        </p>
      );
    default:
      return (
        <p>
          Procure no menu do navegador uma opção como <strong>Instalar</strong> ou{" "}
          <strong>Adicionar à tela inicial</strong>. Se não houver, use o Chrome ou o Edge.
        </p>
      );
  }
}
