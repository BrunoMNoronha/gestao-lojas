"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Loader2, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import {
  type ApiKeyStatus,
  removeAnthropicApiKey,
  saveAnthropicApiKey,
  testAnthropicApiKey,
} from "@/actions/ai-settings";
import { useConfirm } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatStoreDateTime } from "@/lib/store-time";

// Chave da API Anthropic dos insights (issue #113), em Configurações, só para o ADMIN. O campo
// nunca recebe a chave salva: o servidor devolve só se há chave e os últimos caracteres.

type Busy = "save" | "test" | "remove" | null;

export function AiKeyCard({ initialStatus }: { initialStatus: ApiKeyStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [askConfirm, confirmDialog] = useConfirm();

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("save");
    const res = await saveAnthropicApiKey(key);
    setBusy(null);
    if (!res.success) {
      setError(res.error ?? "Falha ao salvar a chave.");
      return;
    }
    setError(null);
    setKey("");
    if (res.status) setStatus(res.status);
    if (res.warning) toast.warning(res.warning);
    else toast.success("Chave salva e testada. O menu Insights já está disponível.");
    // O item Insights do menu depende da chave salva
    router.refresh();
  };

  const test = async () => {
    setBusy("test");
    const res = await testAnthropicApiKey();
    setBusy(null);
    if (res.success) {
      setError(null);
      toast.success("A Anthropic aceitou a chave salva.");
    } else {
      setError(res.error ?? "Falha ao testar a chave.");
    }
  };

  const remove = async () => {
    const confirmed = await askConfirm({
      title: "Remover a chave da API?",
      description:
        "O menu Insights some até uma nova chave ser salva. As análises já geradas continuam no histórico.",
      confirmLabel: "Remover chave",
      destructive: true,
    });
    if (!confirmed) return;
    setBusy("remove");
    const res = await removeAnthropicApiKey();
    setBusy(null);
    if (!res.success) {
      setError(res.error ?? "Falha ao remover a chave.");
      return;
    }
    setError(null);
    if (res.status) setStatus(res.status);
    toast.success("Chave removida.");
    router.refresh();
  };

  return (
    <Card className="max-w-4xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Sparkles className="text-primary h-5 w-5" aria-hidden />
          Inteligência artificial (Claude)
        </CardTitle>
        <CardDescription>
          Chave da API Anthropic usada na página Insights para analisar os números da loja. O custo
          das análises é cobrado na conta Anthropic dona da chave.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
          <KeyRound className="text-muted-foreground h-4 w-4" aria-hidden />
          {status.configured ? (
            <>
              <Badge variant={status.readable ? "success" : "destructive"}>
                {status.readable ? "Configurada" : "Precisa ser informada de novo"}
              </Badge>
              {status.hint && (
                <span className="font-mono" aria-label={`termina em ${status.hint}`}>
                  ••••{status.hint}
                </span>
              )}
              {status.updatedAt && (
                <span className="text-muted-foreground text-xs">
                  salva em {formatStoreDateTime(status.updatedAt)}
                </span>
              )}
            </>
          ) : (
            <Badge variant="outline">Não configurada</Badge>
          )}
        </div>

        <form onSubmit={save} className="space-y-2">
          <Label htmlFor="ai-key-input" className="text-sm font-medium">
            {status.configured ? "Trocar a chave" : "Chave da API"}
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="ai-key-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-ant-..."
              aria-describedby="ai-key-help"
              aria-invalid={error ? true : undefined}
              className="font-mono sm:flex-1"
            />
            <Button type="submit" disabled={busy !== null || !key.trim()}>
              {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Salvar chave
            </Button>
          </div>
          <p id="ai-key-help" className="text-muted-foreground text-xs">
            Crie a chave em console.anthropic.com. Ela é testada antes de salvar, fica cifrada no
            banco e não volta a ser exibida.
          </p>
        </form>

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        {status.configured && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={test}
              disabled={busy !== null || !status.readable}
            >
              {busy === "test" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <ShieldCheck className="h-4 w-4" aria-hidden />
              )}
              Testar chave
            </Button>
            <Button type="button" variant="outline" onClick={remove} disabled={busy !== null}>
              {busy === "remove" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden />
              )}
              Remover chave
            </Button>
          </div>
        )}

        <p className="text-muted-foreground border-t pt-3 text-xs">
          Ao gerar uma análise, a loja envia à Anthropic só números agregados (vendas, produtos,
          estoque, fiado e caixa), sem nome, documento ou telefone de clientes. Trocar o AUTH_SECRET
          do servidor invalida a chave salva.
        </p>
      </CardContent>
      {confirmDialog}
    </Card>
  );
}
