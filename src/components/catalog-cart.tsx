"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  LocateFixed,
  MapPin,
  MessageCircle,
  Minus,
  Plus,
  RefreshCw,
  ShoppingCart,
  Trash2,
  X,
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
  mapsUrl,
  parseGeoPoint,
  parseQuantityInput,
  quantityInputText,
  quantityStep,
  validQuantity,
  type Fulfillment,
  type GeoPoint,
  type OrderRequest,
  type OrderResponse,
} from "@/lib/catalog-shared";
import { cn, formatCurrency } from "@/lib/utils";

interface Customer {
  name: string;
  fulfillment: Fulfillment;
  address: string;
  location: GeoPoint | null;
  note: string;
}

// "off": GPS do aparelho desligado (POSITION_UNAVAILABLE); "unsupported": navegador sem API ou página
// fora de HTTPS (no celular, http://<IP-da-rede> não libera o GPS)
type GeoStatus = "idle" | "locating" | "ok" | "denied" | "off" | "error" | "unsupported";

// Acima disso a posição veio de Wi-Fi/antena e pode estar a quarteirões do endereço
const LOW_ACCURACY_METERS = 100;

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

const touchButton = "h-11 w-full";

function DeliveryLocation({
  status,
  location,
  onRequest,
  onRemove,
}: {
  status: GeoStatus;
  location: GeoPoint | null;
  onRequest: () => void;
  onRemove: () => void;
}) {
  const lowAccuracy =
    status === "ok" && location?.accuracy !== undefined && location.accuracy > LOW_ACCURACY_METERS;
  const retry = (
    <Button
      type="button"
      variant="outline"
      className={cn(touchButton, "col-span-2")}
      onClick={onRequest}
    >
      <RefreshCw /> Tentar de novo
    </Button>
  );

  return (
    <div className="space-y-3 rounded-lg border p-3 text-sm" aria-busy={status === "locating"}>
      <div aria-live="polite" className="space-y-1">
        {status === "idle" && (
          <p className="flex gap-2">
            <LocateFixed className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
            Compartilhe sua localização para facilitar a entrega.
          </p>
        )}
        {status === "locating" && (
          <p className="flex gap-2">
            <Loader2 className="text-primary mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
            Obtendo sua localização…
          </p>
        )}
        {status === "ok" && location && (
          <>
            <p className="flex gap-2 font-medium">
              <MapPin className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Localização capturada
                {location.accuracy !== undefined && (
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    (precisão ~{location.accuracy} m)
                  </span>
                )}
              </span>
            </p>
            {lowAccuracy && (
              <p className="text-warning pl-6 text-xs">
                Precisão baixa. Vá para um lugar aberto e toque em Atualizar.
              </p>
            )}
            <a
              href={mapsUrl(location)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary ml-6 inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline"
            >
              Ver no mapa
            </a>
          </>
        )}
        {status === "denied" && (
          <p className="flex gap-2">
            <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Permissão de localização negada. Dá para enviar só com o endereço. Para liberar: no
              Android, toque no cadeado da barra de endereço → Permissões → Localização; no iPhone,
              Ajustes → Privacidade → Serviços de Localização → Sites do Safari.
            </span>
          </p>
        )}
        {status === "off" && (
          <p className="flex gap-2">
            <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
            Ative a localização (GPS) do celular e toque em Tentar de novo.
          </p>
        )}
        {status === "error" && (
          <p className="flex gap-2">
            <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
            Não foi possível obter sua localização a tempo.
          </p>
        )}
        {status === "unsupported" && (
          <p className="text-muted-foreground flex gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            Seu navegador não permite compartilhar a localização nesta página. O endereço escrito
            basta.
          </p>
        )}
      </div>

      {status !== "locating" && status !== "unsupported" && (
        <div className="grid grid-cols-2 gap-2">
          {status === "idle" && (
            <Button
              type="button"
              variant="outline"
              className={cn(touchButton, "col-span-2")}
              onClick={onRequest}
            >
              <LocateFixed /> Usar minha localização
            </Button>
          )}
          {status === "ok" && (
            <>
              <Button type="button" variant="outline" className={touchButton} onClick={onRequest}>
                <RefreshCw /> Atualizar
              </Button>
              <Button type="button" variant="outline" className={touchButton} onClick={onRemove}>
                <X /> Remover
              </Button>
            </>
          )}
          {(status === "denied" || status === "off" || status === "error") && retry}
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        Sua localização ajuda o entregador a achar o endereço e vai só na mensagem do WhatsApp.
      </p>
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
    location: null,
    note: "",
  });
  const [geo, setGeo] = useState<GeoStatus>("idle");
  // Cada pedido de GPS ganha um número; respostas de pedidos anteriores são ignoradas
  const geoRequest = useRef(0);
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

  const requestLocation = useCallback(() => {
    if (!window.isSecureContext || !("geolocation" in navigator)) {
      setGeo("unsupported");
      return;
    }
    const id = ++geoRequest.current;
    setGeo("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (id !== geoRequest.current) return;
        const { latitude, longitude, accuracy } = position.coords;
        const point = parseGeoPoint({ lat: latitude, lng: longitude, accuracy });
        if (!point || point === "invalid") {
          setCustomer((prev) => ({ ...prev, location: null }));
          setGeo("error");
          return;
        }
        setCustomer((prev) => ({ ...prev, location: point }));
        setGeo("ok");
      },
      (err) => {
        if (id !== geoRequest.current) return;
        // Não envia uma posição antiga se a atualização falhou
        setCustomer((prev) => ({ ...prev, location: null }));
        setGeo(
          err.code === err.PERMISSION_DENIED
            ? "denied"
            : err.code === err.POSITION_UNAVAILABLE
              ? "off"
              : "error",
        );
      },
      // GPS do aparelho (não só Wi-Fi/antena), com folga para o GPS "frio" do celular
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 },
    );
  }, []);

  const removeLocation = () => {
    geoRequest.current++;
    setCustomer((prev) => ({ ...prev, location: null }));
    setGeo("idle");
  };

  // No celular o cliente sai para os Ajustes, libera a localização (ou liga o GPS) e volta à aba:
  // tenta de novo sozinho, sem esperar outro toque
  useEffect(() => {
    if (geo !== "denied" && geo !== "off") return;
    let permission: PermissionStatus | null = null;
    let cancelled = false;
    const retryIfAllowed = () => {
      if (document.visibilityState !== "visible") return;
      if (geo === "off" || permission?.state === "granted") requestLocation();
    };
    if (geo === "denied" && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((status) => {
          if (cancelled) return;
          permission = status;
          status.addEventListener("change", retryIfAllowed);
        })
        .catch(() => {});
    }
    document.addEventListener("visibilitychange", retryIfAllowed);
    return () => {
      cancelled = true;
      permission?.removeEventListener("change", retryIfAllowed);
      document.removeEventListener("visibilitychange", retryIfAllowed);
    };
  }, [geo, requestLocation]);

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
        location:
          customer.fulfillment === "DELIVERY" ? (customer.location ?? undefined) : undefined,
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
                    "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm",
                    customer.fulfillment === value && "border-primary bg-primary/5",
                  )}
                >
                  <input
                    type="radio"
                    name="fulfillment"
                    value={value}
                    checked={customer.fulfillment === value}
                    onChange={() => {
                      updateCustomer({ fulfillment: value });
                      // O toque em "Entrega" é o gesto que abre o pedido de permissão do GPS
                      if (value === "DELIVERY" && geo !== "ok" && geo !== "locating") {
                        requestLocation();
                      }
                    }}
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

          {customer.fulfillment === "DELIVERY" && (
            <DeliveryLocation
              status={geo}
              location={customer.location}
              onRequest={requestLocation}
              onRemove={removeLocation}
            />
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
