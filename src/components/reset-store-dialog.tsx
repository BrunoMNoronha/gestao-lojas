"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { resetStoreDataAction, type ResetStoreDataResponse } from "@/actions/test-data";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { newOperationId } from "@/lib/operation-id";

interface ResetStoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Nome fantasia salvo nas configurações: o que deve ser digitado para confirmar
  tradeName: string;
  // Resposta definitiva do servidor (concluída ou recusada com impedimentos)
  onDone: (response: ResetStoreDataResponse) => void;
}

// Confirmação forte da restauração do banco (issue #57): nome fantasia da loja e senha de quem está
// logado. O botão só habilita com o nome igual, e o servidor confere os dois de novo. O componente
// pai troca a `key` a cada abertura, reiniciando o formulário.
export function ResetStoreDialog({ open, onOpenChange, tradeName, onDone }: ResetStoreDialogProps) {
  const [typedName, setTypedName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mantido enquanto não houver resposta: repetir depois de uma resposta perdida devolve o
  // resultado já gravado, sem apagar de novo
  const requestId = useRef<string | null>(null);

  const nameMatches = typedName.trim() !== "" && typedName.trim() === tradeName.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameMatches || !password || loading) return;

    requestId.current ??= newOperationId();
    setLoading(true);
    setError(null);
    let response: ResetStoreDataResponse;
    try {
      response = await resetStoreDataAction({
        requestId: requestId.current,
        tradeName: typedName,
        password,
      });
    } catch {
      setLoading(false);
      setError("Sem resposta do servidor. Confira a conexão e tente de novo.");
      return;
    }
    setLoading(false);
    requestId.current = null;
    setPassword("");

    if (response.success || response.blockers) {
      onDone(response);
      return;
    }
    setError(response.error);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="text-destructive h-5 w-5" />
            <DialogTitle>Restaurar banco</DialogTitle>
          </div>
          <DialogDescription>
            Esta ação apaga definitivamente vendas, caixas, fiado, estoque e cadastros. Não pode ser
            desfeita.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div
            role="alert"
            className="text-destructive bg-destructive/10 border-destructive/20 rounded-md border p-2.5 text-xs"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="reset-store-trade-name" className="text-foreground text-xs font-medium">
              Digite <span className="font-semibold">{tradeName}</span> para confirmar
            </Label>
            <Input
              id="reset-store-trade-name"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={loading}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reset-store-password" className="text-foreground text-xs font-medium">
              Sua senha
            </Label>
            <Input
              id="reset-store-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              maxLength={72}
              disabled={loading}
              required
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!nameMatches || !password || loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Restaurando...
                </>
              ) : (
                "Apagar e restaurar"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
