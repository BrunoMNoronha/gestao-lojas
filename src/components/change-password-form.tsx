"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changeOwnPassword } from "@/actions/users";

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDone(false);
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
      setDone(true);
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
      {done && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-600/30 bg-emerald-50/50 p-2.5 text-xs text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" /> Senha alterada com sucesso.
        </div>
      )}
      <div className="space-y-1">
        <label className="text-foreground text-xs font-medium">Senha atual</label>
        <Input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      <div className="space-y-1">
        <label className="text-foreground text-xs font-medium">Nova senha</label>
        <Input
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
        <label className="text-foreground text-xs font-medium">Confirmar nova senha</label>
        <Input
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
