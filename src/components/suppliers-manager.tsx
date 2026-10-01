"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Truck,
  Plus,
  Search,
  Edit2,
  Trash2,
  Phone,
  Mail,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { SupplierItem, deleteSupplier } from "@/actions/suppliers";
import { SupplierDialog } from "@/components/supplier-dialog";

interface SuppliersManagerProps {
  initialSuppliers: SupplierItem[];
}

export function SuppliersManager({ initialSuppliers }: SuppliersManagerProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [supplierToEdit, setSupplierToEdit] = useState<SupplierItem | null>(null);

  const filteredSuppliers = initialSuppliers.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.document?.toLowerCase().includes(q) ||
      s.phone?.toLowerCase().includes(q) ||
      s.email?.toLowerCase().includes(q)
    );
  });

  const handleOpenNew = () => {
    setSupplierToEdit(null);
    setDialogOpen(true);
  };

  const handleOpenEdit = (supplier: SupplierItem) => {
    setSupplierToEdit(supplier);
    setDialogOpen(true);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Deseja realmente excluir o fornecedor "${name}"?`)) return;

    const res = await deleteSupplier(id);
    if (res.success) {
      router.refresh();
    } else {
      alert(res.error || "Erro ao excluir fornecedor.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Truck className="w-6 h-6 text-primary" />
            Gestão de Fornecedores
          </h1>
          <p className="text-sm text-muted-foreground">
            Cadastre e gerencie a lista de distribuidores e fornecedores da loja.
          </p>
        </div>

        <Button onClick={handleOpenNew} className="flex items-center gap-1.5">
          <Plus className="w-4 h-4" />
          Novo Fornecedor
        </Button>
      </div>

      {/* Filter / Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar fornecedor por razão social, CNPJ/CPF, telefone ou e-mail..."
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
          {filteredSuppliers.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <Truck className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <h3 className="font-semibold text-base">Nenhum fornecedor encontrado</h3>
              <p className="text-sm text-muted-foreground max-w-sm mt-1">
                {searchQuery
                  ? "Nenhum resultado para os termos da busca."
                  : "Cadastre seu primeiro fornecedor para organizar os pedidos e compras."}
              </p>
              {!searchQuery && (
                <Button onClick={handleOpenNew} className="mt-4">
                  <Plus className="w-4 h-4 mr-1.5" /> Cadastrar Fornecedor
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fornecedor / Razão Social</TableHead>
                  <TableHead>CNPJ / CPF</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Endereço</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSuppliers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      <div>
                        <span>{s.name}</span>
                      </div>
                    </TableCell>

                    <TableCell className="text-muted-foreground text-xs font-mono">
                      {s.document || "-"}
                    </TableCell>

                    <TableCell className="text-xs space-y-0.5">
                      {s.phone && (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Phone className="w-3 h-3 shrink-0" /> {s.phone}
                        </div>
                      )}
                      {s.email && (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Mail className="w-3 h-3 shrink-0" /> {s.email}
                        </div>
                      )}
                      {!s.phone && !s.email && <span className="text-muted-foreground">-</span>}
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                      {s.address ? (
                        <span className="flex items-center gap-1" title={s.address}>
                          <MapPin className="w-3 h-3 shrink-0" /> {s.address}
                        </span>
                      ) : (
                        "-"
                      )}
                    </TableCell>

                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => handleOpenEdit(s)}
                          title="Editar fornecedor"
                        >
                          <Edit2 className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => handleDelete(s.id, s.name)}
                          title="Excluir fornecedor"
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <SupplierDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        supplierToEdit={supplierToEdit}
        onSuccess={() => router.refresh()}
      />
    </div>
  );
}
