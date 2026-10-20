"use client";

import { useState } from "react";
import { Truck, Plus, Search, Edit2, Trash2, Phone, Mail, MapPin } from "lucide-react";
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
import { useConfirm } from "@/components/confirm-dialog";
import { displayDocument, displayPhone, matchesMaskedValue } from "@/lib/masks";
import { EmptyState } from "@/components/empty-state";
import { IconButton } from "@/components/icon-button";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";

interface SuppliersManagerProps {
  initialSuppliers: SupplierItem[];
}

export function SuppliersManager({ initialSuppliers }: SuppliersManagerProps) {
  const [askConfirm, confirmDialog] = useConfirm();
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [supplierToEdit, setSupplierToEdit] = useState<SupplierItem | null>(null);

  const filteredSuppliers = initialSuppliers.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      matchesMaskedValue(s.document, q) ||
      matchesMaskedValue(s.phone, q) ||
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
    const confirmed = await askConfirm({
      title: "Excluir fornecedor?",
      description: `O fornecedor "${name}" será removido. Esta ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!confirmed) return;

    const res = await deleteSupplier(id);
    if (res.success) {
      toast.success("Fornecedor excluído.");
    } else {
      toast.error(res.error || "Erro ao excluir fornecedor.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fornecedores"
        icon={Truck}
        description="Cadastre e gerencie a lista de distribuidores e fornecedores da loja."
        actions={
          <Button onClick={handleOpenNew}>
            <Plus />
            Novo Fornecedor
          </Button>
        }
      />

      {/* Filter / Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              aria-label="Buscar fornecedor"
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
            <EmptyState
              className="border-0"
              icon={Truck}
              title="Nenhum fornecedor encontrado"
              description={
                searchQuery
                  ? "Nenhum resultado para os termos da busca."
                  : "Cadastre seu primeiro fornecedor para organizar os pedidos e compras."
              }
              action={
                !searchQuery && (
                  <Button onClick={handleOpenNew}>
                    <Plus /> Cadastrar Fornecedor
                  </Button>
                )
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fornecedor / Razão Social</TableHead>
                  <TableHead className="hidden md:table-cell">CNPJ / CPF</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead className="hidden lg:table-cell">Endereço</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSuppliers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="min-w-40 font-medium whitespace-normal">
                      <div>
                        <span>{s.name}</span>
                      </div>
                    </TableCell>

                    <TableCell className="text-muted-foreground hidden font-mono text-xs md:table-cell">
                      {displayDocument(s.document) || "-"}
                    </TableCell>

                    <TableCell className="space-y-0.5 text-xs">
                      {s.phone && (
                        <div className="text-muted-foreground flex items-center gap-1">
                          <Phone className="h-3 w-3 shrink-0" /> {displayPhone(s.phone)}
                        </div>
                      )}
                      {s.email && (
                        <div className="text-muted-foreground flex items-center gap-1">
                          <Mail className="h-3 w-3 shrink-0" /> {s.email}
                        </div>
                      )}
                      {!s.phone && !s.email && <span className="text-muted-foreground">-</span>}
                    </TableCell>

                    <TableCell className="text-muted-foreground hidden max-w-xs truncate text-xs lg:table-cell">
                      {s.address ? (
                        <span className="flex items-center gap-1" title={s.address}>
                          <MapPin className="h-3 w-3 shrink-0" /> {s.address}
                        </span>
                      ) : (
                        "-"
                      )}
                    </TableCell>

                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <IconButton label="Editar fornecedor" onClick={() => handleOpenEdit(s)}>
                          <Edit2 className="text-muted-foreground" />
                        </IconButton>
                        <IconButton
                          label="Excluir fornecedor"
                          onClick={() => handleDelete(s.id, s.name)}
                        >
                          <Trash2 className="text-destructive" />
                        </IconButton>
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
        onSuccess={() => {}}
      />
      {confirmDialog}
    </div>
  );
}
