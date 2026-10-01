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
import { User, Loader2 } from "lucide-react";
import {
  CustomerItem,
  CustomerInput,
  createCustomer,
  updateCustomer,
} from "@/actions/customers";

interface CustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerToEdit?: CustomerItem | null;
  onSuccess: () => void;
}

export function CustomerDialog({
  open,
  onOpenChange,
  customerToEdit,
  onSuccess,
}: CustomerDialogProps) {
  const [formData, setFormData] = useState<CustomerInput>({
    name: "",
    document: "",
    phone: "",
    email: "",
    address: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (customerToEdit) {
      setFormData({
        id: customerToEdit.id,
        name: customerToEdit.name,
        document: customerToEdit.document || "",
        phone: customerToEdit.phone || "",
        email: customerToEdit.email || "",
        address: customerToEdit.address || "",
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
  }, [customerToEdit, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) {
      setError("O nome do cliente é obrigatório.");
      return;
    }

    setLoading(true);
    setError(null);

    const res = customerToEdit?.id
      ? await updateCustomer(customerToEdit.id, formData)
      : await createCustomer(formData);

    setLoading(false);

    if (res.success) {
      onOpenChange(false);
      onSuccess();
    } else {
      setError(res.error || "Erro ao salvar cliente.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-primary" />
            <DialogTitle>
              {customerToEdit ? "Editar Cliente" : "Novo Cliente"}
            </DialogTitle>
          </div>
          <DialogDescription>
            {customerToEdit
              ? "Atualize as informações do cliente."
              : "Preencha os campos para cadastrar um novo cliente."}
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
              Nome Completo / Razão Social <span className="text-destructive">*</span>
            </label>
            <Input
              placeholder="Ex: João da Silva"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Documento (CPF ou CNPJ)
              </label>
              <Input
                placeholder="000.000.000-00"
                value={formData.document || ""}
                onChange={(e) => setFormData({ ...formData, document: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Telefone / WhatsApp
              </label>
              <Input
                placeholder="(00) 90000-0000"
                value={formData.phone || ""}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">E-mail</label>
            <Input
              type="email"
              placeholder="cliente@exemplo.com"
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
              ) : customerToEdit ? (
                "Atualizar Cliente"
              ) : (
                "Cadastrar Cliente"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
