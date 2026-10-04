"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ListChecks, ReceiptText, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ReceiptModal } from "@/components/receipt-modal";
import { toStoreSettings } from "@/components/offline-pdv/store-settings";
import {
  readMeta,
  UNSENT_STATUSES,
  userDb,
  type LocalOperation,
  type LocalOperationStatus,
} from "@/lib/offline/db";
import { compareQueueOrder, localSaleCode, toCompletedSale } from "@/lib/offline/sale-operation";
import { formatStoreDateTime } from "@/lib/store-time";
import { cn, formatCurrency } from "@/lib/utils";

// Vendas guardadas neste aparelho (issue #38, docs/OFFLINE.md seção 4): situação de cada uma,
// separando falha temporária (nova tentativa automática) de recusa por regra de negócio, e o
// recibo, provisório ou já com o código oficial da venda.

type BadgeVariant = "warning" | "info" | "success" | "destructive" | "secondary";

const STATUS: Record<LocalOperationStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: "Pendente de envio", variant: "warning" },
  syncing: { label: "Sincronizando", variant: "info" },
  failed: { label: "Falha ao enviar", variant: "warning" },
  synced: { label: "Sincronizada", variant: "success" },
  conflict: { label: "Conflito", variant: "destructive" },
  discarded: { label: "Descartada", variant: "secondary" },
  rejected: { label: "Erro: avise o gerente", variant: "destructive" },
};

const HINT: Partial<Record<LocalOperationStatus, string>> = {
  pending: "Será enviada assim que houver conexão com o servidor.",
  failed: "Nada foi gravado no servidor. Nova tentativa automática com conexão.",
  conflict:
    "A venda chegou ao servidor, mas não foi aplicada. Um gerente vai aprovar ou descartar.",
  rejected: "O servidor recusou a venda sem gravá-la. Ela fica guardada aqui; avise o gerente.",
};

const PAYMENT: Record<string, string> = {
  MONEY: "Dinheiro",
  PIX: "PIX",
  CREDIT_CARD: "Crédito",
  DEBIT_CARD: "Débito",
};

function statusOf(op: LocalOperation) {
  if (op.status === "synced" && op.approved) {
    return { label: "Aprovada pelo gerente", variant: "success" as const };
  }
  return STATUS[op.status];
}

interface OfflineQueuePanelProps {
  userId: string;
  online: boolean;
  busy: boolean;
  onSend: () => void;
}

export function OfflineQueuePanel({ userId, online, busy, onSend }: OfflineQueuePanelProps) {
  const [open, setOpen] = useState(false);
  const [receipt, setReceipt] = useState<LocalOperation | null>(null);

  const data = useLiveQuery(async () => {
    const db = userDb(userId);
    const [operations, store] = await Promise.all([
      db.operations.toArray().then((rows) => rows.sort((a, b) => compareQueueOrder(b, a))),
      readMeta(db, "store"),
    ]);
    return { operations, store: store ?? null };
  }, [userId]);

  const operations = data?.operations ?? [];
  const unsent = operations.filter((op) => UNSENT_STATUSES.includes(op.status)).length;
  const conflicts = operations.filter((op) => op.status === "conflict").length;
  if (operations.length === 0) return null;

  const summary =
    unsent > 0
      ? `${unsent} ${unsent === 1 ? "venda a enviar" : "vendas a enviar"}`
      : conflicts > 0
        ? `${conflicts} em conflito`
        : "Vendas sincronizadas";

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className={cn(
          "gap-1.5",
          unsent > 0 && "border-warning/40 text-warning",
          unsent === 0 && conflicts > 0 && "border-destructive/40 text-destructive",
        )}
        onClick={() => setOpen(true)}
      >
        <ListChecks className="h-4 w-4" />
        {summary}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Vendas deste aparelho</DialogTitle>
            <DialogDescription>
              Vendas feitas no PDV deste aparelho e a situação do envio ao servidor. Vendas
              sincronizadas ficam aqui por 24 horas para reimpressão do recibo.
            </DialogDescription>
          </DialogHeader>

          {online ? (
            <Button
              variant="outline"
              size="sm"
              className="w-fit gap-1.5"
              onClick={onSend}
              disabled={busy}
            >
              <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
              Enviar agora
            </Button>
          ) : (
            <p className="text-muted-foreground text-xs">
              Sem conexão com o servidor: as vendas seguem guardadas e são enviadas sozinhas quando
              a conexão voltar.
            </p>
          )}

          <ul className="divide-y rounded-lg border">
            {operations.map((op) => {
              const status = statusOf(op);
              // Linha sem os dados da venda (só possível vinda da versão 1 da estrutura)
              if (!op.request || !op.receipt) {
                return (
                  <li key={op.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                    <span className="font-mono font-semibold">{localSaleCode(op.id)}</span>
                    <Badge variant={status.variant}>{status.label}</Badge>
                    <span className="text-destructive text-xs">{op.message}</span>
                  </li>
                );
              }
              const hint = HINT[op.status];
              return (
                <li key={op.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 p-3 text-sm">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-semibold">{localSaleCode(op.id)}</span>
                      {op.sale && (
                        <span className="text-muted-foreground">Venda #{op.sale.code}</span>
                      )}
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {formatStoreDateTime(op.request.occurredAt)} ·{" "}
                      {PAYMENT[op.request.payload.paymentMethod]} · {op.receipt.customerName}
                    </p>
                    {(op.message || hint) && (
                      <p
                        className={cn(
                          "text-xs",
                          op.status === "conflict" || op.status === "rejected"
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {op.message ?? hint}
                        {op.message && hint && op.status !== "pending" ? ` ${hint}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">
                      {formatCurrency(Number(op.receipt.total))}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5"
                      onClick={() => setReceipt(op)}
                    >
                      <ReceiptText className="h-4 w-4" />
                      Recibo
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>

      <ReceiptModal
        open={receipt !== null}
        onOpenChange={(value) => !value && setReceipt(null)}
        sale={receipt ? toCompletedSale(receipt) : null}
        storeSettings={toStoreSettings(data?.store)}
        closeLabel="Fechar"
      />
    </>
  );
}
