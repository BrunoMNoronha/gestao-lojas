"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { KeyRound, Loader2 } from "lucide-react";
import { UserItem, resetUserPassword } from "@/actions/users";

interface UserPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserItem | null;
  onSuccess: () => void;
}

// O componente pai troca a `key` a cada abertura, reiniciando o formulário
export function UserPasswordDialog({
  open,
  onOpenChange,
  user,
  onSuccess,
}: UserPasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (password.length < 8) return setError("A nova senha deve ter no mínimo 8 caracteres.");
    if (password !== confirmation) return setError("A confirmação não confere com a nova senha.");

    setLoading(true);
    setError(null);
    const res = await resetUserPassword(user.id, password);
    setLoading(false);

    if (res.success) {
      onOpenChange(false);
      onSuccess();
    } else {
      setError(res.error || "Erro ao redefinir a senha.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="text-primary h-5 w-5" />
            <DialogTitle>Redefinir Senha</DialogTitle>
          </div>
          {user && (
            <DialogDescription>
              Nova senha para {user.name} ({user.email}). A senha anterior deixa de funcionar.
            </DialogDescription>
          )}
        </DialogHeader>

        {error && (
          <div className="text-destructive bg-destructive/10 border-destructive/20 rounded-md border p-2.5 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-foreground text-xs font-medium">Nova senha</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              maxLength={72}
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-foreground text-xs font-medium">Confirmar nova senha</label>
            <Input
              type="password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando...
                </>
              ) : (
                "Redefinir Senha"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
