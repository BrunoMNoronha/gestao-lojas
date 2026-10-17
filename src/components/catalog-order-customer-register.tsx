"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Link2, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getCatalogOrderCustomerMatches,
  linkCatalogOrderCustomer,
  registerCatalogOrderCustomer,
  type CustomerMatch,
  type CustomerMatches,
} from "@/actions/catalog-orders";
import { displayDocument, displayPhone } from "@/lib/masks";

// Cadastro do cliente do pedido do catálogo (issue #81) com o nome e o telefone do pedido.
// Mesmo telefone já cadastrado bloqueia (só vincular); nome igual avisa e pede confirmação.
export function CatalogOrderCustomerRegister({
  orderId,
  name: initialName,
  phone,
  onDone,
}: {
  orderId: string;
  name: string;
  phone: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [matches, setMatches] = useState<CustomerMatches | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setOpen(true);
    setError(null);
    setLoading(true);
    const found = await getCatalogOrderCustomerMatches(orderId).catch(() => null);
    setLoading(false);
    if (!found) setError("Não foi possível conferir os clientes cadastrados.");
    setMatches(found);
  };

  const register = async (confirmSimilarName: boolean) => {
    setBusy(true);
    setError(null);
    const result = await registerCatalogOrderCustomer({ orderId, name, confirmSimilarName }).catch(
      () => ({ success: false as const, error: "Falha ao cadastrar o cliente." }),
    );
    setBusy(false);
    if (result.success) {
      toast.success(`Cliente ${result.customer.name} cadastrado e vinculado ao pedido.`);
      onDone();
      return;
    }
    // Corrida ou nome repetido: mostra a lista atualizada que veio do servidor
    if ("matches" in result && result.matches) setMatches(result.matches);
    setError(result.error);
  };

  const link = async (customer: CustomerMatch) => {
    setBusy(true);
    setError(null);
    const result = await linkCatalogOrderCustomer({ orderId, customerId: customer.id }).catch(
      () => ({ success: false as const, error: "Falha ao vincular o cliente." }),
    );
    setBusy(false);
    if (result.success) {
      toast.success(`Pedido vinculado a ${customer.name}.`);
      onDone();
    } else {
      setError(result.error);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={start}
        className="text-primary inline-flex min-h-11 items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
      >
        <UserPlus className="size-4" aria-hidden /> Cadastrar cliente
      </button>
    );
  }

  const phoneTaken = (matches?.byPhone.length ?? 0) > 0;
  const similarName = (matches?.byName.length ?? 0) > 0;

  const matchList = (list: CustomerMatch[]) => (
    <ul className="divide-y rounded-md border">
      {list.map((customer) => (
        <li key={customer.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
          <span className="min-w-0">
            <span className="block font-medium break-words">{customer.name}</span>
            <span className="text-muted-foreground block text-xs">
              {[
                customer.phone && displayPhone(customer.phone),
                customer.document && displayDocument(customer.document),
              ]
                .filter(Boolean)
                .join(" · ") || "Sem telefone"}
            </span>
          </span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => link(customer)}>
            <Link2 /> Vincular
          </Button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="mt-2 space-y-3 rounded-md border p-3 text-sm">
      {loading ? (
        <p className="text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Conferindo clientes cadastrados…
        </p>
      ) : (
        <>
          {phoneTaken ? (
            <div className="space-y-2" role="status">
              <p className="text-warning flex gap-2 font-medium">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                Já existe cliente com o telefone {displayPhone(phone)}. Vincule o pedido a ele.
              </p>
              {matchList(matches!.byPhone)}
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label htmlFor={`pedido-${orderId}-cliente-nome`} className="text-xs">
                  Nome do cliente
                </Label>
                <Input
                  id={`pedido-${orderId}-cliente-nome`}
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <p className="text-muted-foreground text-xs">Telefone: {displayPhone(phone)}</p>
              </div>
              {similarName && (
                <div className="space-y-2" role="status">
                  <p className="text-warning flex gap-2 font-medium">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    Há cliente com o mesmo nome. Se for a mesma pessoa, vincule; senão, cadastre
                    mesmo assim.
                  </p>
                  {matchList(matches!.byName)}
                </div>
              )}
            </>
          )}

          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {!phoneTaken && (
              <Button
                size="sm"
                disabled={busy || name.trim().length < 2}
                onClick={() => register(similarName)}
              >
                {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
                {similarName ? "Cadastrar mesmo assim" : "Cadastrar e vincular"}
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
