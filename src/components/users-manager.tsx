"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Edit2, KeyRound, Plus, Power, Search, UserCog, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserItem, getUsers, setUserActive } from "@/actions/users";
import { UserDialog } from "@/components/user-dialog";
import { UserPasswordDialog } from "@/components/user-password-dialog";
import { type AppRole, ROLE_LABELS } from "@/lib/permissions";
import { formatStoreDateTime } from "@/lib/store-time";
import { cn } from "@/lib/utils";

interface UsersManagerProps {
  initialUsers: UserItem[];
  currentUserId: string;
}

interface Filters {
  search: string;
  role: "" | AppRole;
  status: "" | "active" | "inactive";
}

const EMPTY_FILTERS: Filters = { search: "", role: "", status: "" };
const selectClassName =
  "w-full h-8 px-2.5 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring";

const roleBadgeClass: Record<AppRole, string> = {
  ADMIN: "border-primary/40 text-primary",
  MANAGER: "border-sky-600/30 text-sky-700 dark:text-sky-400",
  SELLER: "border-border text-muted-foreground",
};

export function UsersManager({ initialUsers, currentUserId }: UsersManagerProps) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [error, setError] = useState<string | null>(null);

  // Trocar a key remonta os diálogos e reinicia os formulários a cada abertura
  const [dialogKey, setDialogKey] = useState(0);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [selected, setSelected] = useState<UserItem | null>(null);

  const hasFilters = Object.values(filters).some(Boolean);

  const load = async (next: Filters) => {
    const list = await getUsers({
      search: next.search || null,
      role: next.role || null,
      active: next.status === "" ? null : next.status === "active",
    });
    setUsers(list);
  };

  const updateFilters = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    load(next);
  };

  const refresh = () => {
    router.refresh();
    load(filters);
  };

  const openUserDialog = (user: UserItem | null) => {
    setDialogKey((k) => k + 1);
    setSelected(user);
    setUserDialogOpen(true);
  };

  const openPasswordDialog = (user: UserItem) => {
    setDialogKey((k) => k + 1);
    setSelected(user);
    setPasswordDialogOpen(true);
  };

  const toggleActive = async (user: UserItem) => {
    const action = user.active ? "desativar" : "reativar";
    if (!confirm(`Deseja ${action} o usuário "${user.name}"?`)) return;
    setError(null);
    const res = await setUserActive(user.id, !user.active);
    if (res.success) refresh();
    else setError(res.error || `Erro ao ${action} o usuário.`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <UserCog className="text-primary h-6 w-6" />
            Usuários
          </h1>
          <p className="text-muted-foreground text-sm">
            Cadastre operadores e gerentes, defina o perfil de acesso e controle quem pode entrar.
          </p>
        </div>
        <Button onClick={() => openUserDialog(null)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Novo Usuário
        </Button>
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 items-end gap-3 p-4 sm:grid-cols-[2fr_1fr_1fr_auto]">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              placeholder="Buscar por nome ou e-mail..."
              value={filters.search}
              onChange={(e) => updateFilters({ search: e.target.value })}
              className="pl-9"
            />
          </div>
          <select
            className={selectClassName}
            value={filters.role}
            onChange={(e) => updateFilters({ role: e.target.value as Filters["role"] })}
          >
            <option value="">Todos os perfis</option>
            {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <select
            className={selectClassName}
            value={filters.status}
            onChange={(e) => updateFilters({ status: e.target.value as Filters["status"] })}
          >
            <option value="">Todas as situações</option>
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
          </select>
          <Button
            variant="ghost"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              load(EMPTY_FILTERS);
            }}
            disabled={!hasFilters}
            className="gap-1"
          >
            <X className="h-4 w-4" />
            Limpar
          </Button>
        </CardContent>
      </Card>

      {error && (
        <div className="text-destructive bg-destructive/10 border-destructive/20 rounded-md border p-3 text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {users.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <Users className="text-muted-foreground/50 mb-3 h-12 w-12" />
              <h3 className="text-base font-semibold">Nenhum usuário encontrado</h3>
              <p className="text-muted-foreground mt-1 max-w-sm text-sm">
                {hasFilters ? "Tente ajustar os filtros." : "Cadastre o primeiro usuário."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead className="text-center">Perfil</TableHead>
                  <TableHead className="text-center">Situação</TableHead>
                  <TableHead>Criado em</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const isSelf = u.id === currentUserId;
                  return (
                    <TableRow key={u.id} className={cn(!u.active && "opacity-60")}>
                      <TableCell className="font-medium">
                        {u.name}
                        {isSelf && (
                          <span className="text-muted-foreground ml-1 text-xs">(você)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{u.email}</TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className={cn("text-[11px]", roleBadgeClass[u.role])}
                        >
                          {ROLE_LABELS[u.role]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[11px]",
                            u.active
                              ? "border-emerald-600/30 text-emerald-600 dark:text-emerald-400"
                              : "border-destructive/30 text-destructive",
                          )}
                        >
                          {u.active ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                        {formatStoreDateTime(u.createdAt)}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => openUserDialog(u)}
                            title="Editar usuário"
                          >
                            <Edit2 className="text-muted-foreground h-4 w-4" />
                          </Button>
                          {!isSelf && (
                            <>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => openPasswordDialog(u)}
                                title="Redefinir senha"
                              >
                                <KeyRound className="text-muted-foreground h-4 w-4" />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => toggleActive(u)}
                                title={u.active ? "Desativar usuário" : "Reativar usuário"}
                              >
                                <Power
                                  className={cn(
                                    "h-4 w-4",
                                    u.active ? "text-destructive" : "text-emerald-600",
                                  )}
                                />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <UserDialog
        key={`user-${dialogKey}`}
        open={userDialogOpen}
        onOpenChange={setUserDialogOpen}
        userToEdit={selected}
        isSelf={selected?.id === currentUserId}
        onSuccess={refresh}
      />
      <UserPasswordDialog
        key={`password-${dialogKey}`}
        open={passwordDialogOpen}
        onOpenChange={setPasswordDialogOpen}
        user={selected}
        onSuccess={refresh}
      />
    </div>
  );
}
