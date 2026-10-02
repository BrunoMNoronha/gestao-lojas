"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changeOwnPassword } from "@/actions/users";
import { Label } from "@/components/ui/label";

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 8) return setError("A nova senha deve ter no mínimo 8 caracteres.");
    if (next !== confirmation) return setError("A confirmação não confere com a nova senha.");

    setLoading(true);
    setError(null);
    const res = await changeOwnPassword({ currentPassword: current, newPassword: next });
    setLoading(false);

    if (res.success) {
      setCurrent("");
      setNext("");
      setConfirmation("");
      toast.success("Senha alterada com sucesso.");
    } else {
      setError(res.error || "Erro ao trocar a senha.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="text-destructive bg-destructive/10 border-destructive/20 rounded-md border p-2.5 text-xs">
          {error}
        </div>
      )}
      <div className="space-y-1">
        <Label
          htmlFor="change-password-senha-atual"
          className="text-foreground text-xs font-medium"
        >
          Senha atual
        </Label>
        <Input
          id="change-password-senha-atual"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="change-password-nova-senha" className="text-foreground text-xs font-medium">
          Nova senha
        </Label>
        <Input
          id="change-password-nova-senha"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          required
        />
      </div>
      <div className="space-y-1">
        <Label
          htmlFor="change-password-confirmar-nova-senha"
          className="text-foreground text-xs font-medium"
        >
          Confirmar nova senha
        </Label>
        <Input
          id="change-password-confirmar-nova-senha"
          type="password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>
      <Button type="submit" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando...
          </>
        ) : (
          "Trocar Senha"
        )}
      </Button>
    </form>
  );
}
