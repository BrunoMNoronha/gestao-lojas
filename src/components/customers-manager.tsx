"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Users, Plus, Search, Edit2, Trash2, Phone, Mail, MapPin, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { CustomerItem, deleteCustomer } from "@/actions/customers";
import { CustomerDialog } from "@/components/customer-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { displayDocument, displayPhone, matchesMaskedValue } from "@/lib/masks";
import { EmptyState } from "@/components/empty-state";
import { IconButton } from "@/components/icon-button";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";

interface CustomersManagerProps {
  initialCustomers: CustomerItem[];
  // Exclusão restrita por perfil (customers.delete)
  canDelete: boolean;
}

export function CustomersManager({ initialCustomers, canDelete }: CustomersManagerProps) {
  const router = useRouter();
  const [askConfirm, confirmDialog] = useConfirm();
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [customerToEdit, setCustomerToEdit] = useState<CustomerItem | null>(null);

  const filteredCustomers = initialCustomers.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      matchesMaskedValue(c.document, q) ||
      matchesMaskedValue(c.phone, q) ||
      c.email?.toLowerCase().includes(q)
    );
  });

  const handleOpenNew = () => {
    setCustomerToEdit(null);
    setDialogOpen(true);
  };

  const handleOpenEdit = (customer: CustomerItem) => {
    setCustomerToEdit(customer);
    setDialogOpen(true);
  };

  const handleDelete = async (id: string, name: string) => {
    const confirmed = await askConfirm({
      title: "Excluir cliente?",
      description: `O cliente "${name}" será removido. Esta ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!confirmed) return;

    const res = await deleteCustomer(id);
    if (res.success) {
      toast.success("Cliente excluído.");
      router.refresh();
    } else {
      toast.error(res.error || "Erro ao excluir cliente.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes"
        icon={Users}
        description="Cadastre e acompanhe o histórico dos seus clientes."
        actions={
          <Button onClick={handleOpenNew}>
            <Plus />
            Novo Cliente
          </Button>
        }
      />

      {/* Filter / Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              aria-label="Buscar cliente"
              placeholder="Buscar cliente por nome, CPF/CNPJ, telefone ou e-mail..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filteredCustomers.length === 0 ? (
            <EmptyState
              className="border-0"
              icon={Users}
              title="Nenhum cliente encontrado"
              description={
                searchQuery
                  ? "Nenhum resultado para os termos da busca."
                  : "Cadastre seu primeiro cliente para vincular às vendas do sistema."
              }
              action={
                !searchQuery && (
                  <Button onClick={handleOpenNew}>
                    <Plus /> Cadastrar Cliente
                  </Button>
                )
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="hidden md:table-cell">CPF / CNPJ</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead className="hidden lg:table-cell">Endereço</TableHead>
                  <TableHead className="text-center">Vendas</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCustomers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="min-w-40 font-medium whitespace-normal">
                      <div>
                        <span>{c.name}</span>
                      </div>
                    </TableCell>

                    <TableCell className="text-muted-foreground hidden font-mono text-xs md:table-cell">
                      {displayDocument(c.document) || "-"}
                    </TableCell>

                    <TableCell className="space-y-0.5 text-xs">
                      {c.phone && (
                        <div className="text-muted-foreground flex items-center gap-1">
                          <Phone className="h-3 w-3 shrink-0" /> {displayPhone(c.phone)}
                        </div>
                      )}
                      {c.email && (
                        <div className="text-muted-foreground flex items-center gap-1">
                          <Mail className="h-3 w-3 shrink-0" /> {c.email}
                        </div>
                      )}
                      {!c.phone && !c.email && <span className="text-muted-foreground">-</span>}
                    </TableCell>

                    <TableCell className="text-muted-foreground hidden max-w-xs truncate text-xs lg:table-cell">
                      {c.address ? (
                        <span className="flex items-center gap-1" title={c.address}>
                          <MapPin className="h-3 w-3 shrink-0" /> {c.address}
                        </span>
                      ) : (
                        "-"
                      )}
                    </TableCell>

                    <TableCell className="text-center">
                      <Badge variant="outline" className="gap-1 text-xs">
                        <ShoppingBag className="h-3 w-3" />
                        {c._count?.sales ?? 0}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <IconButton label="Editar cliente" onClick={() => handleOpenEdit(c)}>
                          <Edit2 className="text-muted-foreground" />
                        </IconButton>
                        {canDelete && (
                          <IconButton
                            label="Excluir cliente"
                            onClick={() => handleDelete(c.id, c.name)}
                          >
                            <Trash2 className="text-destructive" />
                          </IconButton>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CustomerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        customerToEdit={customerToEdit}
        onSuccess={() => router.refresh()}
      />
      {confirmDialog}
    </div>
  );
}
