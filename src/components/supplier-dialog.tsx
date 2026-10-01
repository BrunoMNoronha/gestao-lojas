"use client";

import { useEffect, useState } from "react";
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
import { Truck, Loader2 } from "lucide-react";
import {
  SupplierItem,
  SupplierInput,
  createSupplier,
  updateSupplier,
} from "@/actions/suppliers";

interface SupplierDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierToEdit?: SupplierItem | null;
  onSuccess: () => void;
}

export function SupplierDialog({
  open,
  onOpenChange,
  supplierToEdit,
  onSuccess,
}: SupplierDialogProps) {
  const [formData, setFormData] = useState<SupplierInput>({
    name: "",
    document: "",
    phone: "",
    email: "",
    address: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (supplierToEdit) {
      setFormData({
        id: supplierToEdit.id,
        name: supplierToEdit.name,
        document: supplierToEdit.document || "",
        phone: supplierToEdit.phone || "",
        email: supplierToEdit.email || "",
        address: supplierToEdit.address || "",
      });
    } else {
      setFormData({
        name: "",
        document: "",
        phone: "",
        email: "",
        address: "",
      });
    }
    setError(null);
  }, [supplierToEdit, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) {
      setError("O nome / razão social do fornecedor é obrigatório.");
      return;
    }

    setLoading(true);
    setError(null);

    const res = supplierToEdit?.id
      ? await updateSupplier(supplierToEdit.id, formData)
      : await createSupplier(formData);

    setLoading(false);

    if (res.success) {
      onOpenChange(false);
      onSuccess();
    } else {
      setError(res.error || "Erro ao salvar fornecedor.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" />
            <DialogTitle>
              {supplierToEdit ? "Editar Fornecedor" : "Novo Fornecedor"}
            </DialogTitle>
          </div>
          <DialogDescription>
            {supplierToEdit
              ? "Atualize as informações do fornecedor."
              : "Preencha os campos para cadastrar um novo fornecedor."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-2.5 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">
              Razão Social / Nome Fantasia <span className="text-destructive">*</span>
            </label>
            <Input
              placeholder="Ex: Distribuidora de Bebidas Brasil Ltda"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Documento (CNPJ ou CPF)
              </label>
              <Input
                placeholder="00.000.000/0001-00"
                value={formData.document || ""}
                onChange={(e) => setFormData({ ...formData, document: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Telefone / Contato
              </label>
              <Input
                placeholder="(00) 3000-0000"
                value={formData.phone || ""}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">E-mail Comercial</label>
            <Input
              type="email"
              placeholder="contato@fornecedor.com"
              value={formData.email || ""}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">Endereço Completo</label>
            <Input
              placeholder="Rua, Número, Bairro, Cidade - UF"
              value={formData.address || ""}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...
                </>
              ) : supplierToEdit ? (
                "Atualizar Fornecedor"
              ) : (
                "Cadastrar Fornecedor"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
