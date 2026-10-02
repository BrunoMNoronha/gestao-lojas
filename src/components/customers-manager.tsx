"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  Plus,
  Search,
  Edit2,
  Trash2,
  Phone,
  Mail,
  MapPin,
  ShoppingBag,
} from "lucide-react";
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

interface CustomersManagerProps {
  initialCustomers: CustomerItem[];
  // Exclusão restrita por perfil (customers.delete)
  canDelete: boolean;
}

export function CustomersManager({ initialCustomers, canDelete }: CustomersManagerProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [customerToEdit, setCustomerToEdit] = useState<CustomerItem | null>(null);

  const filteredCustomers = initialCustomers.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.document?.toLowerCase().includes(q) ||
      c.phone?.toLowerCase().includes(q) ||
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
    if (!confirm(`Deseja realmente excluir o cliente "${name}"?`)) return;

    const res = await deleteCustomer(id);
    if (res.success) {
      router.refresh();
    } else {
      alert(res.error || "Erro ao excluir cliente.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" />
            Gestão de Clientes
          </h1>
          <p className="text-sm text-muted-foreground">
            Cadastre e acompanhe o histórico dos seus clientes.
          </p>
        </div>

        <Button onClick={handleOpenNew} className="flex items-center gap-1.5">
          <Plus className="w-4 h-4" />
          Novo Cliente
        </Button>
      </div>

      {/* Filter / Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
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
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <Users className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <h3 className="font-semibold text-base">Nenhum cliente encontrado</h3>
              <p className="text-sm text-muted-foreground max-w-sm mt-1">
                {searchQuery
                  ? "Nenhum resultado para os termos da busca."
                  : "Cadastre seu primeiro cliente para vincular às vendas do sistema."}
              </p>
              {!searchQuery && (
                <Button onClick={handleOpenNew} className="mt-4">
                  <Plus className="w-4 h-4 mr-1.5" /> Cadastrar Cliente
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>CPF / CNPJ</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Endereço</TableHead>
                  <TableHead className="text-center">Vendas</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCustomers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      <div>
                        <span>{c.name}</span>
                      </div>
                    </TableCell>

                    <TableCell className="text-muted-foreground text-xs font-mono">
                      {c.document || "-"}
                    </TableCell>

                    <TableCell className="text-xs space-y-0.5">
                      {c.phone && (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Phone className="w-3 h-3 shrink-0" /> {c.phone}
                        </div>
                      )}
                      {c.email && (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Mail className="w-3 h-3 shrink-0" /> {c.email}
                        </div>
                      )}
                      {!c.phone && !c.email && <span className="text-muted-foreground">-</span>}
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                      {c.address ? (
                        <span className="flex items-center gap-1" title={c.address}>
                          <MapPin className="w-3 h-3 shrink-0" /> {c.address}
                        </span>
                      ) : (
                        "-"
                      )}
                    </TableCell>

                    <TableCell className="text-center">
                      <Badge variant="outline" className="text-xs gap-1">
                        <ShoppingBag className="w-3 h-3" />
                        {c._count?.sales ?? 0}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => handleOpenEdit(c)}
                          title="Editar cliente"
                        >
                          <Edit2 className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                        </Button>
                        {canDelete && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => handleDelete(c.id, c.name)}
                            title="Excluir cliente"
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
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
    </div>
  );
}
