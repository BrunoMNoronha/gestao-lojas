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
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { IconButton } from "@/components/icon-button";
import { OptionSelect } from "@/components/option-select";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
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

const roleBadgeClass: Record<AppRole, string> = {
  ADMIN: "border-primary/40 text-primary",
  MANAGER: "border-info/30 text-info",
  SELLER: "border-border text-muted-foreground",
};

export function UsersManager({ initialUsers, currentUserId }: UsersManagerProps) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [askConfirm, confirmDialog] = useConfirm();

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
    const confirmed = await askConfirm({
      title: user.active ? "Desativar usuário?" : "Reativar usuário?",
      description: user.active
        ? `"${user.name}" não poderá mais entrar no sistema até ser reativado.`
        : `"${user.name}" voltará a ter acesso ao sistema.`,
      confirmLabel: user.active ? "Desativar" : "Reativar",
      destructive: user.active,
    });
    if (!confirmed) return;
    const res = await setUserActive(user.id, !user.active);
    if (res.success) {
      toast.success(user.active ? "Usuário desativado." : "Usuário reativado.");
      refresh();
    } else {
      toast.error(res.error || `Erro ao ${action} o usuário.`);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuários"
        icon={UserCog}
        description="Cadastre operadores e gerentes, defina o perfil de acesso e controle quem pode entrar."
        actions={
          <Button onClick={() => openUserDialog(null)}>
            <Plus />
            Novo Usuário
          </Button>
        }
      />

      <Card>
        <CardContent className="grid grid-cols-1 items-end gap-3 p-4 sm:grid-cols-[2fr_1fr_1fr_auto]">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              aria-label="Buscar usuário"
              placeholder="Buscar por nome ou e-mail..."
              value={filters.search}
              onChange={(e) => updateFilters({ search: e.target.value })}
              className="pl-9"
            />
          </div>
          <OptionSelect
            aria-label="Filtrar por perfil"
            value={filters.role}
            onValueChange={(v) => updateFilters({ role: v as Filters["role"] })}
            options={[
              { value: "", label: "Todos os perfis" },
              ...(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => ({
                value: r,
                label: ROLE_LABELS[r],
              })),
            ]}
          />
          <OptionSelect
            aria-label="Filtrar por situação"
            value={filters.status}
            onValueChange={(v) => updateFilters({ status: v as Filters["status"] })}
            options={[
              { value: "", label: "Todas as situações" },
              { value: "active", label: "Ativos" },
              { value: "inactive", label: "Inativos" },
            ]}
          />
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

      <Card>
        <CardContent className="p-0">
          {users.length === 0 ? (
            <EmptyState
              className="border-0"
              icon={Users}
              title="Nenhum usuário encontrado"
              description={
                hasFilters ? "Tente ajustar os filtros." : "Cadastre o primeiro usuário."
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead className="hidden md:table-cell">E-mail</TableHead>
                  <TableHead className="text-center">Perfil</TableHead>
                  <TableHead className="text-center">Situação</TableHead>
                  <TableHead className="hidden lg:table-cell">Criado em</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const isSelf = u.id === currentUserId;
                  return (
                    <TableRow key={u.id} className={cn(!u.active && "opacity-60")}>
                      <TableCell className="min-w-40 font-medium whitespace-normal">
                        {u.name}
                        {isSelf && (
                          <span className="text-muted-foreground ml-1 text-xs">(você)</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">{u.email}</TableCell>
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
                          variant={u.active ? "success" : "destructive"}
                          className="text-[11px]"
                        >
                          {u.active ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs whitespace-nowrap lg:table-cell">
                        {formatStoreDateTime(u.createdAt)}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <IconButton label="Editar usuário" onClick={() => openUserDialog(u)}>
                            <Edit2 className="text-muted-foreground" />
                          </IconButton>
                          {!isSelf && (
                            <>
                              <IconButton
                                label="Redefinir senha"
                                onClick={() => openPasswordDialog(u)}
                              >
                                <KeyRound className="text-muted-foreground" />
                              </IconButton>
                              <IconButton
                                label={u.active ? "Desativar usuário" : "Reativar usuário"}
                                onClick={() => toggleActive(u)}
                              >
                                <Power className={u.active ? "text-destructive" : "text-success"} />
                              </IconButton>
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
      {confirmDialog}
    </div>
  );
}
