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
import { Loader2, UserCog } from "lucide-react";
import { UserItem, createUser, updateUser } from "@/actions/users";
import { type AppRole, ROLE_LABELS } from "@/lib/permissions";

interface UserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userToEdit: UserItem | null;
  // Perfil do próprio administrador não pode ser alterado
  isSelf: boolean;
  onSuccess: () => void;
}

const ROLES: AppRole[] = ["ADMIN", "MANAGER", "SELLER"];
const selectClassName =
  "w-full h-8 px-2.5 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";

// O componente pai troca a `key` a cada abertura, reiniciando o formulário
export function UserDialog({ open, onOpenChange, userToEdit, isSelf, onSuccess }: UserDialogProps) {
  const [name, setName] = useState(userToEdit?.name ?? "");
  const [email, setEmail] = useState(userToEdit?.email ?? "");
  const [role, setRole] = useState<AppRole>(userToEdit?.role ?? "SELLER");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!userToEdit;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("O nome é obrigatório.");
    if (!email.trim()) return setError("O e-mail é obrigatório.");
    if (!isEdit && password.length < 8) {
      return setError("A senha inicial deve ter no mínimo 8 caracteres.");
    }

    setLoading(true);
    setError(null);
    const res = isEdit
      ? await updateUser(userToEdit.id, { name, email, role })
      : await createUser({ name, email, role, password });
    setLoading(false);

    if (res.success) {
      onOpenChange(false);
      onSuccess();
    } else {
      setError(res.error || "Erro ao salvar o usuário.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <UserCog className="text-primary h-5 w-5" />
            <DialogTitle>{isEdit ? "Editar Usuário" : "Novo Usuário"}</DialogTitle>
          </div>
          <DialogDescription>
            {isEdit
              ? "Atualize os dados e o perfil de acesso do usuário."
              : "Cadastre um usuário e defina o perfil de acesso e a senha inicial."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="text-destructive bg-destructive/10 border-destructive/20 rounded-md border p-2.5 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-foreground text-xs font-medium">
              Nome <span className="text-destructive">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-foreground text-xs font-medium">
              E-mail <span className="text-destructive">*</span>
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-foreground text-xs font-medium">Perfil de acesso</label>
            <select
              className={selectClassName}
              value={role}
              onChange={(e) => setRole(e.target.value as AppRole)}
              disabled={isSelf}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            {isSelf && (
              <p className="text-muted-foreground text-[11px]">
                Você não pode alterar o seu próprio perfil.
              </p>
            )}
          </div>

          {!isEdit && (
            <div className="space-y-1">
              <label className="text-foreground text-xs font-medium">
                Senha inicial <span className="text-destructive">*</span>
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                required
              />
              <p className="text-muted-foreground text-[11px]">
                Mínimo de 8 caracteres. Oriente o usuário a trocá-la em &quot;Minha conta&quot;.
              </p>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando...
                </>
              ) : isEdit ? (
                "Salvar Alterações"
              ) : (
                "Cadastrar Usuário"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
