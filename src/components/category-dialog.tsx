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
import {
  CategoryData,
  createCategory,
  updateCategory,
  deleteCategory,
} from "@/actions/categories";

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

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir esta categoria?")) return;

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
            <FolderKanban className="w-5 h-5 text-primary" />
            <DialogTitle>Gerenciar Categorias</DialogTitle>
          </div>
          <DialogDescription>
            Adicione, edite ou remova categorias para organizar seus produtos.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-2.5 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md">
            {error}
          </div>
        )}

        {/* Form para Nova Categoria */}
        <form onSubmit={handleCreate} className="flex gap-2">
          <Input
            placeholder="Nome da nova categoria..."
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" disabled={loading || !newCategoryName.trim()}>
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Plus className="w-4 h-4 mr-1" /> Criar
              </>
            )}
          </Button>
        </form>

        {/* Lista de Categorias */}
        <div className="mt-4 max-h-60 overflow-y-auto space-y-2 pr-1">
          {categories.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              Nenhuma categoria cadastrada.
            </p>
          ) : (
            categories.map((cat) => (
              <div
                key={cat.id}
                className="flex items-center justify-between p-2.5 rounded-lg border bg-card text-sm"
              >
                {editingId === cat.id ? (
                  <div className="flex items-center gap-2 flex-1 mr-2">
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="h-8 text-xs"
                      autoFocus
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => handleUpdate(cat.id)}
                      disabled={loading}
                    >
                      <Check className="w-4 h-4 text-green-600" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingId(null);
                        setEditingName("");
                      }}
                    >
                      <X className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{cat.name}</span>
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                        {cat._count?.products ?? 0} produto(s)
                      </Badge>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(cat.id);
                          setEditingName(cat.name);
                        }}
                      >
                        <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => handleDelete(cat.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
