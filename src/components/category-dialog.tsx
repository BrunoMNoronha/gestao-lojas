"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit2, Trash2, Check, X, Loader2, FolderKanban } from "lucide-react";
import { CategoryData, createCategory, updateCategory, deleteCategory } from "@/actions/categories";
import { useConfirm } from "@/components/confirm-dialog";
import { IconButton } from "@/components/icon-button";

interface CategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: CategoryData[];
  onCategoryChange: () => void;
}

export function CategoryDialog({
  open,
  onOpenChange,
  categories,
  onCategoryChange,
}: CategoryDialogProps) {
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askConfirm, confirmDialog] = useConfirm();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    setLoading(true);
    setError(null);
    const res = await createCategory(newCategoryName);
    setLoading(false);

    if (res.success) {
      setNewCategoryName("");
      onCategoryChange();
    } else {
      setError(res.error || "Erro ao criar categoria.");
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editingName.trim()) return;

    setLoading(true);
    setError(null);
    const res = await updateCategory(id, editingName);
    setLoading(false);

    if (res.success) {
      setEditingId(null);
      setEditingName("");
      onCategoryChange();
    } else {
      setError(res.error || "Erro ao atualizar categoria.");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const confirmed = await askConfirm({
      title: "Excluir categoria?",
      description: `A categoria "${name}" será removida. Esta ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!confirmed) return;

    setLoading(true);
    setError(null);
    const res = await deleteCategory(id);
    setLoading(false);

    if (res.success) {
      onCategoryChange();
    } else {
      setError(res.error || "Erro ao excluir categoria.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <FolderKanban className="text-primary h-5 w-5" />
            <DialogTitle>Gerenciar Categorias</DialogTitle>
          </div>
          <DialogDescription>
            Adicione, edite ou remova categorias para organizar seus produtos.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="text-destructive bg-destructive/10 border-destructive/20 rounded-md border p-2.5 text-xs">
            {error}
          </div>
        )}

        {/* Form para Nova Categoria */}
        <form onSubmit={handleCreate} className="flex gap-2">
          <Input
            aria-label="Nome da nova categoria"
            placeholder="Nome da nova categoria..."
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" disabled={loading || !newCategoryName.trim()}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Plus className="mr-1 h-4 w-4" /> Criar
              </>
            )}
          </Button>
        </form>

        {/* Lista de Categorias */}
        <div className="mt-4 max-h-60 space-y-2 overflow-y-auto pr-1">
          {categories.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-xs">
              Nenhuma categoria cadastrada.
            </p>
          ) : (
            categories.map((cat) => (
              <div
                key={cat.id}
                className="bg-card flex items-center justify-between rounded-lg border p-2.5 text-sm"
              >
                {editingId === cat.id ? (
                  <div className="mr-2 flex flex-1 items-center gap-2">
                    <Input
                      aria-label="Novo nome da categoria"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="h-8 text-xs"
                      autoFocus
                    />
                    <IconButton
                      label="Salvar nome"
                      onClick={() => handleUpdate(cat.id)}
                      disabled={loading}
                    >
                      <Check className="text-success" />
                    </IconButton>
                    <IconButton
                      label="Cancelar edição"
                      onClick={() => {
                        setEditingId(null);
                        setEditingName("");
                      }}
                    >
                      <X className="text-muted-foreground" />
                    </IconButton>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{cat.name}</span>
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                        {cat._count?.products ?? 0} produto(s)
                      </Badge>
                    </div>

                    <div className="flex items-center gap-1">
                      <IconButton
                        label={`Editar categoria ${cat.name}`}
                        onClick={() => {
                          setEditingId(cat.id);
                          setEditingName(cat.name);
                        }}
                      >
                        <Edit2 className="text-muted-foreground size-3.5" />
                      </IconButton>
                      <IconButton
                        label={`Excluir categoria ${cat.name}`}
                        onClick={() => handleDelete(cat.id, cat.name)}
                      >
                        <Trash2 className="text-destructive size-3.5" />
                      </IconButton>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </DialogContent>
      {confirmDialog}
    </Dialog>
  );
}
