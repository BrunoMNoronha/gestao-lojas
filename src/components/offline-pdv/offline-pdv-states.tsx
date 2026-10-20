"use client";

import { useState } from "react";
import { CloudDownload, CloudOff, Loader2, ShieldAlert, Wallet } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import type { OfflineBlock } from "@/lib/offline/sync";
import type { PrepareReason } from "@/components/offline-pdv/use-offline-pdv";

// Telas do /pdv fora do terminal (issue #37): preparar o aparelho, sem acesso e indisponível sem
// conexão, sempre explicando o motivo.

const PREPARE_TEXT: Record<PrepareReason, { title: string; description: string }> = {
  first: {
    title: "Preparar o PDV para uso sem internet",
    description:
      "Baixa para este aparelho os produtos, os clientes (com documento parcial) e os dados da loja, e vincula o seu caixa aberto. Depois, o PDV abre e consulta mesmo sem conexão por até 12 horas.",
  },
  expired: {
    title: "Renovar o uso sem internet",
    description:
      "A autorização para usar o PDV sem internet neste aparelho venceu (vale 12 horas). Renove para continuar.",
  },
  cash_changed: {
    title: "Preparar para o novo caixa",
    description:
      "O caixa aberto agora é outro. Prepare o aparelho de novo para vincular o PDV ao caixa atual.",
  },
  cash_closed: {
    title: "Caixa fechado",
    description:
      "Abra o seu caixa com o suprimento inicial e depois prepare o aparelho para usar o PDV.",
  },
};

export function PrepareState({
  reason,
  error,
  onPrepare,
}: {
  reason: PrepareReason;
  error: string | null;
  onPrepare: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const text = PREPARE_TEXT[reason];

  if (reason === "cash_closed") {
    return (
      <EmptyState
        fullPage
        headingLevel="h1"
        icon={Wallet}
        tone="primary"
        title={text.title}
        description={error ?? text.description}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <a href="/admin/caixa" className={buttonVariants()}>
              Abrir caixa
            </a>
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onPrepare();
                setBusy(false);
              }}
            >
              Já abri, preparar
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <EmptyState
      fullPage
      headingLevel="h1"
      icon={CloudDownload}
      tone="primary"
      title={text.title}
      description={
        <>
          {text.description}
          {error && (
            <span role="alert" className="text-destructive mt-3 block font-medium">
              {error}
            </span>
          )}
        </>
      }
      action={
        <Button
          className="gap-2"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onPrepare();
            setBusy(false);
          }}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CloudDownload className="h-4 w-4" />
          )}
          {reason === "expired" ? "Renovar" : "Preparar este aparelho"}
        </Button>
      }
    />
  );
}

export function ForbiddenState() {
  return (
    <EmptyState
      fullPage
      headingLevel="h1"
      icon={ShieldAlert}
      tone="destructive"
      title="Sem acesso à Frente de Caixa"
      description="O seu perfil não tem permissão para usar o PDV. Os dados guardados neste aparelho foram apagados."
      action={
        <a href="/admin" className={buttonVariants({ variant: "outline" })}>
          Voltar ao painel
        </a>
      }
    />
  );
}

const BLOCK_TEXT: Record<OfflineBlock, string> = {
  not_prepared:
    "Este aparelho não foi preparado para usar o PDV sem internet, ou o uso sem internet foi encerrado. Quando a conexão voltar, entre no sistema e prepare o aparelho no PDV.",
  incomplete:
    "Os dados do PDV não terminaram de ser baixados neste aparelho. Quando a conexão voltar, abra o PDV para concluir a preparação.",
  grant_expired:
    "A autorização para usar o PDV sem internet venceu (vale 12 horas). Quando a conexão voltar, renove a preparação no PDV.",
  stale:
    "Os dados guardados têm mais de 24 horas e não podem mais ser usados. Quando a conexão voltar, o PDV sincroniza sozinho.",
  cash_mismatch:
    "O caixa vinculado a este aparelho foi fechado ou trocado. Quando a conexão voltar, prepare o aparelho de novo.",
};

export function BlockedState({ reason, onRetry }: { reason: OfflineBlock; onRetry: () => void }) {
  return (
    <EmptyState
      fullPage
      headingLevel="h1"
      icon={CloudOff}
      tone="destructive"
      title="PDV indisponível sem conexão"
      description={BLOCK_TEXT[reason]}
      action={
        <Button variant="outline" onClick={onRetry}>
          Tentar conectar de novo
        </Button>
      }
    />
  );
}
