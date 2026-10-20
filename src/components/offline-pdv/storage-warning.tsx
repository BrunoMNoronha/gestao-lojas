"use client";

import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// Aviso de armazenamento do /pdv (issue #59): aparece quando o navegador não confirmou o
// armazenamento persistente (navigator.storage.persist() negado, com erro ou indisponível). Só
// explica; não pede a permissão de novo nem mexe em preparação, sincronização, carrinho ou fila.
// O texto não promete proteção absoluta nem diz que instalar o app resolve.
export function StorageWarning() {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className="text-warning focus-visible:ring-ring/50 inline-flex cursor-pointer items-center gap-1 rounded-sm underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:ring-2 focus-visible:outline-none"
          />
        }
      >
        <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Armazenamento não garantido pelo navegador
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sobre o armazenamento neste aparelho</DialogTitle>
          <DialogDescription>
            O navegador não confirmou a proteção dos dados do PDV guardados neste aparelho.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm leading-relaxed">
          <p>
            As vendas feitas sem internet ficam salvas aqui até serem enviadas ao servidor, mas
            esses dados podem ser apagados pelo navegador, por exemplo, se faltar espaço.
          </p>
          <p>
            Conecte-se assim que possível, use <strong>Sincronizar</strong> e confira a situação das
            vendas em <strong>Vendas deste aparelho</strong>, no botão de vendas do topo da tela.
            Evite usar aba anônima ou limpar os dados do site enquanto houver vendas pendentes.
          </p>
          <p>
            Este aviso não significa que uma venda já foi perdida. As vendas já sincronizadas
            continuam registradas no servidor.
          </p>
        </div>

        <DialogFooter>
          <DialogClose render={<Button />}>Entendi</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
