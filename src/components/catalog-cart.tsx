"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MessageCircle,
  Minus,
  Plus,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CatalogImage } from "@/components/catalog-image";
import { EmptyState } from "@/components/empty-state";
import { IconButton } from "@/components/icon-button";
import {
  cartActions,
  cartTotal,
  lineSubtotal,
  useCart,
  useCartReady,
  type CartLine,
} from "@/lib/catalog-cart";
import {
  isFractionalUnit,
  parseQuantityInput,
  quantityInputText,
  quantityStep,
  validQuantity,
  type Fulfillment,
  type OrderRequest,
  type OrderResponse,
} from "@/lib/catalog-shared";
import { cn, formatCurrency } from "@/lib/utils";

interface Customer {
  name: string;
  fulfillment: Fulfillment;
  address: string;
  note: string;
}

interface Notices {
  removed: { name: string; reason: "unavailable" | "not_in_catalog" }[];
  priceChanges: { name: string; from: number; to: number }[];
}

interface Review {
  signature: string;
  url: string;
  total: number;
}

// Pedido revisado só vale enquanto carrinho e dados do cliente não mudarem
function signatureOf(cart: CartLine[], customer: Customer): string {
  return JSON.stringify([cart.map((l) => [l.productId, l.quantity, l.price]), customer]);
}

function QuantityControl({ line }: { line: CartLine }) {
  const [text, setText] = useState(quantityInputText(line.quantity));
  const step = quantityStep(line.unit);
  const fractional = isFractionalUnit(line.unit);

  const commit = () => {
    const value = validQuantity(line.unit, parseQuantityInput(text));
    if (value === null || !cartActions.setQuantity(line.productId, value)) {
      setText(quantityInputText(line.quantity));
    }
  };

  const changeBy = (delta: number) => {
    cartActions.setQuantity(line.productId, Math.round((line.quantity + delta) * 1000) / 1000);
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        aria-label={`Diminuir quantidade de ${line.name}`}
        disabled={line.quantity <= step}
        onClick={() => changeBy(-step)}
      >
        <Minus />
      </Button>
      <Input
        aria-label={`Quantidade de ${line.name} (${line.unit})`}
        inputMode={fractional ? "decimal" : "numeric"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        className="h-8 w-16 text-center"
      />
      <Button
        variant="outline"
        size="icon"
        aria-label={`Aumentar quantidade de ${line.name}`}
        onClick={() => changeBy(step)}
      >
        <Plus />
      </Button>
      <span className="text-muted-foreground ml-1 text-xs">{line.unit}</span>
    </div>
  );
}

export function CatalogCart({ canSend }: { canSend: boolean }) {
  const cart = useCart();
  const ready = useCartReady();

  const [customer, setCustomer] = useState<Customer>({
    name: "",
    fulfillment: "PICKUP",
    address: "",
    note: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notices | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [opened, setOpened] = useState(false);
  const [finished, setFinished] = useState(false);

  const total = cartTotal(cart);
  const reviewValid = review && review.signature === signatureOf(cart, customer) ? review : null;

  const updateCustomer = (changes: Partial<Customer>) => {
    setCustomer((prev) => ({ ...prev, ...changes }));
    setError(null);
  };

  const handleReview = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setOpened(false);
    const name = customer.name.trim();
    if (name.length < 2) {
      setError("Informe seu nome.");
      return;
    }
    if (customer.fulfillment === "DELIVERY" && customer.address.trim().length < 5) {
      setError("Informe o endereço de entrega.");
      return;
    }

    const payload: OrderRequest = {
      items: cart.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      customer: {
        name,
        fulfillment: customer.fulfillment,
        note: customer.note.trim() || undefined,
        address: customer.fulfillment === "DELIVERY" ? customer.address.trim() : undefined,
      },
    };

    setLoading(true);
    let data: OrderResponse;
    try {
      const response = await fetch("/api/catalogo/pedido", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      data = (await response.json()) as OrderResponse;
    } catch {
      setLoading(false);
      setError("Não foi possível falar com a loja agora. Verifique sua conexão e tente novamente.");
      return;
    }
    setLoading(false);

    const previous = new Map(cart.map((line) => [line.productId, line]));
    const removed = (data.removed ?? []).map((item) => ({
      name: previous.get(item.productId)?.name ?? "Produto",
      reason: item.reason,
    }));
    const removedIds = (data.removed ?? []).map((item) => item.productId);

    if (!data.ok) {
      if (removedIds.length > 0) cartActions.sync([], removedIds);
      setNotices(removed.length > 0 ? { removed, priceChanges: [] } : null);
      setReview(null);
      setError(data.error);
      return;
    }

    const priceChanges = data.items
      .filter((item) => {
        const before = previous.get(item.productId);
        return before && before.price !== item.price;
      })
      .map((item) => ({
        name: item.name,
        from: previous.get(item.productId)!.price,
        to: item.price,
      }));

    const synced = cartActions.sync(data.items, removedIds);
    setNotices(removed.length > 0 || priceChanges.length > 0 ? { removed, priceChanges } : null);
    setReview({
      signature: signatureOf(synced, customer),
      url: data.whatsappUrl,
      total: data.total,
    });
  };

  const handleFinish = () => {
    cartActions.clear();
    setReview(null);
    setNotices(null);
    setOpened(false);
    setFinished(true);
  };

  if (!ready) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Carregando carrinho">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  const noticesBox = notices && (
    <div
      role="status"
      className="border-warning/30 bg-warning/10 space-y-1 rounded-xl border p-3 text-sm"
    >
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="text-warning size-4 shrink-0" aria-hidden /> Seu carrinho foi
        atualizado
      </p>
      <ul className="text-muted-foreground list-disc space-y-0.5 pl-6">
        {notices.removed.map((item, index) => (
          <li key={`r-${index}`}>
            <span className="text-foreground">{item.name}</span> foi removido:{" "}
            {item.reason === "unavailable" ? "está indisponível." : "não está mais no catálogo."}
          </li>
        ))}
        {notices.priceChanges.map((item, index) => (
          <li key={`p-${index}`}>
            Preço de <span className="text-foreground">{item.name}</span> atualizado:{" "}
            {formatCurrency(item.from)} → {formatCurrency(item.to)}.
          </li>
        ))}
      </ul>
    </div>
  );

  if (cart.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Carrinho</h1>
        {noticesBox}
        {error && <p className="text-destructive text-sm">{error}</p>}
        {finished ? (
          <EmptyState
            icon={CheckCircle2}
            tone="primary"
            title="Pedido enviado"
            description="A loja vai confirmar disponibilidade, entrega e pagamento pelo WhatsApp."
            action={
              <Link href="/catalogo" className={buttonVariants()}>
                Voltar ao catálogo
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={ShoppingCart}
            title="Seu carrinho está vazio"
            description="Escolha produtos no catálogo para montar o pedido."
            action={
              <Link href="/catalogo" className={buttonVariants()}>
                Ver catálogo
              </Link>
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Carrinho</h1>
        <Link href="/catalogo" className="text-primary text-sm font-medium hover:underline">
          Continuar comprando
        </Link>
      </div>

      {noticesBox}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px] lg:items-start">
        <ul className="bg-card divide-y rounded-xl border">
          {cart.map((line) => (
            <li key={line.productId} className="flex gap-3 p-3">
              <CatalogImage
                src={line.imageUrl}
                alt={line.name}
                className="size-16 shrink-0 rounded-lg"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/catalogo/${line.productId}`}
                      className="line-clamp-2 text-sm font-medium break-words hover:underline"
                    >
                      {line.name}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {formatCurrency(line.price)} / {line.unit}
                    </p>
                  </div>
                  <IconButton
                    label={`Remover ${line.name}`}
                    onClick={() => cartActions.remove(line.productId)}
                  >
                    <Trash2 className="text-destructive" />
                  </IconButton>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <QuantityControl key={line.quantity} line={line} />
                  <span className="text-sm font-semibold">
                    {formatCurrency(lineSubtotal(line))}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <form
          onSubmit={handleReview}
          className="bg-card space-y-4 rounded-xl border p-4"
          aria-label="Dados para o pedido"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">Total estimado</span>
            <span className="text-xl font-bold">{formatCurrency(total)}</span>
          </div>

          {!canSend && (
            <p
              role="alert"
              className="border-warning/30 bg-warning/10 flex gap-2 rounded-lg border p-3 text-sm"
            >
              <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />A loja
              ainda não configurou o WhatsApp para pedidos. Você pode montar o carrinho, mas o envio
              está desabilitado no momento.
            </p>
          )}

          <div className="space-y-1">
            <Label htmlFor="pedido-nome" className="text-xs font-medium">
              Seu nome <span className="text-destructive">*</span>
            </Label>
            <Input
              id="pedido-nome"
              autoComplete="name"
              maxLength={80}
              value={customer.name}
              onChange={(e) => updateCustomer({ name: e.target.value })}
              required
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">Como prefere receber?</legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["PICKUP", "Retirar na loja"],
                  ["DELIVERY", "Entrega"],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm",
                    customer.fulfillment === value && "border-primary bg-primary/5",
                  )}
                >
                  <input
                    type="radio"
                    name="fulfillment"
                    value={value}
                    checked={customer.fulfillment === value}
                    onChange={() => updateCustomer({ fulfillment: value })}
                    className="accent-primary size-4"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          {customer.fulfillment === "DELIVERY" && (
            <div className="space-y-1">
              <Label htmlFor="pedido-endereco" className="text-xs font-medium">
                Endereço de entrega <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="pedido-endereco"
                autoComplete="street-address"
                maxLength={300}
                placeholder="Rua, número, bairro e ponto de referência"
                value={customer.address}
                onChange={(e) => updateCustomer({ address: e.target.value })}
                required
              />
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="pedido-observacao" className="text-xs font-medium">
              Observação
            </Label>
            <Textarea
              id="pedido-observacao"
              maxLength={500}
              placeholder="Opcional"
              value={customer.note}
              onChange={(e) => updateCustomer({ note: e.target.value })}
            />
          </div>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          {reviewValid ? (
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-sm">
                Pedido conferido com a loja: <strong>{formatCurrency(reviewValid.total)}</strong>{" "}
                (estimado). Preços e disponibilidade sujeitos a confirmação.
              </p>
              <a
                href={reviewValid.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpened(true)}
                className={cn(buttonVariants({ size: "lg" }), "w-full")}
              >
                <MessageCircle /> Enviar pelo WhatsApp
              </a>
              {opened && (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-muted-foreground text-sm">Já enviou a mensagem no WhatsApp?</p>
                  <Button type="button" variant="outline" className="w-full" onClick={handleFinish}>
                    <CheckCircle2 /> Sim, esvaziar o carrinho
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <Button type="submit" size="lg" className="w-full" disabled={!canSend || loading}>
              {loading ? <Loader2 className="animate-spin" /> : <MessageCircle />}
              {loading ? "Conferindo pedido..." : "Revisar pedido"}
            </Button>
          )}
          <p className="text-muted-foreground text-xs">
            Conferimos itens e preços com a loja antes de abrir o WhatsApp. Nada é cobrado aqui.
          </p>
        </form>
      </div>
    </div>
  );
}
