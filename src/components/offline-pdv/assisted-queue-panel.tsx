"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Loader2, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { otherOperatorQueues } from "@/lib/offline/db";
import { sendQueue } from "@/lib/offline/queue";

// Envio assistido (issue #38, docs/OFFLINE.md seção 3.5): um gerente, com conexão, envia as
// vendas que outro operador deixou guardadas neste aparelho (ele saiu, foi desativado ou perdeu o
// acesso antes de sincronizar). Elas chegam como conflito, com a autoria original, para
// conferência na tela "Sincronização offline". Só aparece para quem tem offline.reconcile.

export function AssistedQueuePanel({ sessionUserId }: { sessionUserId: string }) {
  const [open, setOpen] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const queues = useLiveQuery(() => otherOperatorQueues(sessionUserId), [sessionUserId]);

  if (!queues || queues.length === 0) return null;
  const total = queues.reduce((sum, q) => sum + q.unsent, 0);

  const send = async (userId: string, userName: string) => {
    setSendingId(userId);
    try {
      const summary = await sendQueue(userId, { includeConflicts: true });
      if (summary.status === "done") {
        toast.success(`Vendas de ${userName} enviadas para conferência em Sincronização offline.`);
      } else if (summary.status === "busy") {
        toast.info("Outra aba deste navegador está enviando essas vendas. Tente em seguida.");
      } else {
        toast.error("Não foi possível enviar agora. As vendas seguem guardadas no aparelho.");
      }
    } catch (error) {
      console.error("Erro no envio assistido:", error);
      toast.error("Não foi possível enviar agora. As vendas seguem guardadas no aparelho.");
    } finally {
      setSendingId(null);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <Users className="h-4 w-4" />
        {total > 0 ? `${total} de outros operadores` : "Vendas de outros operadores"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Vendas de outros operadores neste aparelho</DialogTitle>
            <DialogDescription>
              Vendas feitas sem internet por operadores que não estão mais neste aparelho. Ao
              enviar, elas chegam como conflito, com o operador original, para você conferir e
              aprovar ou descartar em Sincronização offline.
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y rounded-lg border text-sm">
            {queues.map((q) => (
              <li key={q.userId} className="flex items-center justify-between gap-3 p-3">
                <div>
                  <p className="font-medium">{q.userName}</p>
                  <p className="text-muted-foreground text-xs">
                    {q.unsent} {q.unsent === 1 ? "venda não enviada" : "vendas não enviadas"}
                    {q.conflicts > 0 && ` · ${q.conflicts} em conferência`}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={sendingId !== null}
                  onClick={() => send(q.userId, q.userName)}
                >
                  {sendingId === q.userId ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {q.unsent > 0 ? "Enviar para conferência" : "Consultar decisão"}
                </Button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
