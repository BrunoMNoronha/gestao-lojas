"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ShoppingCart,
  Search,
  Trash2,
  Plus,
  Minus,
  DollarSign,
  CreditCard,
  Smartphone,
  Banknote,
  BookOpen,
  Loader2,
  X,
  UserRound,
  ReceiptText,
  AlertTriangle,
  Keyboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ProductItem } from "@/actions/products";
import { CustomerItem } from "@/actions/customers";
import { StoreSettingsData } from "@/actions/settings";
import { createSale } from "@/actions/sales";
import { ReceiptModal, CompletedSale } from "@/components/receipt-modal";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { IconButton } from "@/components/icon-button";

interface CartItem {
  productId: string;
  name: string;
  unit: string;
  barcode: string | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  maxStock: number;
}

type PaymentMethodKey = "MONEY" | "PIX" | "CREDIT_CARD" | "DEBIT_CARD" | "ON_ACCOUNT";

const paymentMethods: { key: PaymentMethodKey; label: string; icon: React.ElementType }[] = [
  { key: "MONEY", label: "Dinheiro", icon: Banknote },
  { key: "PIX", label: "PIX", icon: Smartphone },
  { key: "CREDIT_CARD", label: "Crédito", icon: CreditCard },
  { key: "DEBIT_CARD", label: "Débito", icon: CreditCard },
  { key: "ON_ACCOUNT", label: "Fiado", icon: BookOpen },
];

const shortcuts: { key: string; label: string }[] = [
  { key: "F2", label: "Buscar produto" },
  { key: "F4", label: "Cliente" },
  { key: "F8", label: "Desconto" },
  { key: "F10", label: "Finalizar / Confirmar" },
  { key: "Esc", label: "Fechar / Limpar busca" },
];

// Unidades vendidas apenas em quantidades inteiras (as demais aceitam até 3 casas decimais)
const INTEGER_UNITS = ["UN", "CX"];

const isIntegerUnit = (unit: string) => INTEGER_UNITS.includes(unit);

const roundQuantity = (value: number, unit: string) =>
  isIntegerUnit(unit) ? Math.floor(value) : Math.round(value * 1000) / 1000;

const roundMoney = (value: number) => Math.round(value * 100) / 100;

const formatQuantity = (value: number, unit: string) =>
  formatNumber(value, isIntegerUnit(unit) ? 0 : 3);

interface QuantityInputProps {
  item: CartItem;
  onCommit: (productId: string, quantity: number) => void;
}

// Campo de quantidade editável: mantém o texto digitado localmente e só aplica ao carrinho
// ao confirmar (Enter/blur), para permitir digitar valores como "0,5" sem remover o item.
function QuantityInput({ item, onCommit }: QuantityInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const parsed = parseFloat(draft.replace(",", "."));
    setDraft(null);
    if (Number.isFinite(parsed)) onCommit(item.productId, parsed);
  };

  return (
    <Input
      type="text"
      inputMode={isIntegerUnit(item.unit) ? "numeric" : "decimal"}
      aria-label={`Quantidade de ${item.name}`}
      value={draft ?? formatQuantity(item.quantity, item.unit)}
      onFocus={(e) => {
        setDraft(formatQuantity(item.quantity, item.unit));
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      className="h-7 w-20 text-center font-mono font-semibold"
    />
  );
}

interface PdvTerminalProps {
  products: ProductItem[];
  customers: CustomerItem[];
  storeSettings: StoreSettingsData;
}

export function PdvTerminal({ products, customers, storeSettings }: PdvTerminalProps) {
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const discountInputRef = useRef<HTMLInputElement>(null);

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  // Search & product suggestions
  const [searchQuery, setSearchQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Customer selection
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerItem | null>(null);
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");

  // Payment / Checkout
  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethodKey>("MONEY");
  const [amountPaid, setAmountPaid] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Receipt modal
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null);

  // Calculations
  // (apenas exibição: o servidor recalcula tudo a partir do banco)
  const subtotal = roundMoney(cart.reduce((sum, item) => sum + item.subtotal, 0));
  // Desconto nunca excede o subtotal (ex.: quando itens são removidos após aplicá-lo)
  const effectiveDiscount = Math.min(discount, subtotal);
  const total = roundMoney(Math.max(0, subtotal - effectiveDiscount));
  const change = selectedPayment === "MONEY" ? roundMoney(Math.max(0, amountPaid - total)) : 0;
  const needsCustomer = selectedPayment === "ON_ACCOUNT" && !selectedCustomer;

  // Focus search on mount and after sale
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Product suggestions filtered
  const filteredProducts = searchQuery.trim()
    ? products
        .filter((p) => {
          const q = searchQuery.toLowerCase();
          return (
            p.name.toLowerCase().includes(q) ||
            p.barcode?.toLowerCase().includes(q) ||
            p.sku?.toLowerCase().includes(q)
          );
        })
        .slice(0, 8)
    : [];

  // Customer suggestions filtered
  const filteredCustomers = customerSearch.trim()
    ? customers.filter((c) => {
        const q = customerSearch.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.document?.toLowerCase().includes(q) ||
          c.phone?.toLowerCase().includes(q)
        );
      })
    : customers;

  // Add product to cart (respects available stock)
  const addToCart = useCallback(
    (product: ProductItem) => {
      const existing = cart.find((item) => item.productId === product.id);
      const nextQty = (existing?.quantity ?? 0) + 1;

      if (nextQty > product.currentStock) {
        setNotice(
          `Estoque insuficiente para "${product.name}" (disponível: ${formatQuantity(
            product.currentStock,
            product.unit,
          )} ${product.unit}).`,
        );
      } else {
        setNotice(null);
        setCart((prev) => {
          if (prev.some((item) => item.productId === product.id)) {
            return prev.map((item) =>
              item.productId === product.id
                ? { ...item, quantity: nextQty, subtotal: roundMoney(nextQty * item.unitPrice) }
                : item,
            );
          }
          return [
            ...prev,
            {
              productId: product.id,
              name: product.name,
              unit: product.unit,
              barcode: product.barcode,
              quantity: 1,
              unitPrice: product.salePrice,
              subtotal: product.salePrice,
              maxStock: product.currentStock,
            },
          ];
        });
      }

      setSearchQuery("");
      setShowSuggestions(false);
      searchInputRef.current?.focus();
    },
    [cart],
  );

  // Handle barcode/enter from search
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      // Exact match by barcode or SKU
      const exactMatch = products.find(
        (p) =>
          p.barcode?.toLowerCase() === searchQuery.trim().toLowerCase() ||
          p.sku?.toLowerCase() === searchQuery.trim().toLowerCase(),
      );
      if (exactMatch) {
        addToCart(exactMatch);
      } else if (filteredProducts.length === 1) {
        addToCart(filteredProducts[0]);
      } else if (filteredProducts.length === 0) {
        setNotice(`Nenhum produto encontrado para "${searchQuery.trim()}".`);
      }
    }
  };

  // Set item quantity (clamped to available stock; zero or less removes the item)
  const setQuantity = (productId: string, requested: number) => {
    const item = cart.find((i) => i.productId === productId);
    if (!item) return;

    let quantity = roundQuantity(requested, item.unit);
    if (quantity > item.maxStock) {
      quantity = roundQuantity(item.maxStock, item.unit);
      setNotice(
        `Estoque insuficiente para "${item.name}" (disponível: ${formatQuantity(
          item.maxStock,
          item.unit,
        )} ${item.unit}).`,
      );
    } else {
      setNotice(null);
    }

    setCart((prev) =>
      quantity <= 0
        ? prev.filter((i) => i.productId !== productId)
        : prev.map((i) =>
            i.productId === productId
              ? { ...i, quantity, subtotal: roundMoney(quantity * i.unitPrice) }
              : i,
          ),
    );
  };

  const updateQuantity = (productId: string, delta: number) => {
    const item = cart.find((i) => i.productId === productId);
    if (item) setQuantity(productId, item.quantity + delta);
  };

  // Remove item
  const removeItem = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.productId !== productId));
    setNotice(null);
  };

  const focusSearch = () => {
    // Defer so it runs after any dialog finishes closing and releases focus
    setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  // Clear cart
  const clearCart = () => {
    setCart([]);
    setDiscount(0);
    setSelectedCustomer(null);
    setError(null);
    setNotice(null);
    focusSearch();
  };

  const openCustomerDialog = () => {
    setCheckoutDialogOpen(false);
    setCustomerSearch("");
    setCustomerDialogOpen(true);
  };

  // Open checkout
  const openCheckout = () => {
    if (cart.length === 0) return;
    setAmountPaid(total);
    setSelectedPayment("MONEY");
    setError(null);
    setCheckoutDialogOpen(true);
  };

  // Finalize sale
  const finalizeSale = async () => {
    if (cart.length === 0 || loading) return;

    if (needsCustomer) {
      setError("Venda no Fiado exige um cliente. Selecione o cliente (F4) antes de confirmar.");
      return;
    }

    if (selectedPayment === "MONEY" && amountPaid < total) {
      setError("O valor recebido não pode ser menor que o total da venda.");
      return;
    }

    setLoading(true);
    setError(null);

    const res = await createSale({
      customerId: selectedCustomer?.id || null,
      paymentMethod: selectedPayment,
      discount: effectiveDiscount,
      amountPaid: selectedPayment === "MONEY" ? amountPaid : undefined,
      items: cart.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      })),
    });

    setLoading(false);

    if (res.success && res.data) {
      setCompletedSale(res.data as CompletedSale);
      setCheckoutDialogOpen(false);
      setReceiptOpen(true);
      clearCart();
      router.refresh();
    } else {
      setError(res.error || "Erro ao processar a venda.");
    }
  };

  // Global keyboard shortcuts. A ref keeps the listener stable while always calling
  // the latest handlers (which close over current cart/payment state).
  const shortcutHandlers = useRef({
    focusSearch,
    openCustomerDialog,
    openCheckout,
    finalizeSale,
  });
  const dialogState = useRef({ checkoutDialogOpen, customerDialogOpen, receiptOpen });

  useEffect(() => {
    shortcutHandlers.current = { focusSearch, openCustomerDialog, openCheckout, finalizeSale };
    dialogState.current = { checkoutDialogOpen, customerDialogOpen, receiptOpen };
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const handlers = shortcutHandlers.current;
      const dialogs = dialogState.current;
      const anyDialogOpen =
        dialogs.checkoutDialogOpen || dialogs.customerDialogOpen || dialogs.receiptOpen;

      switch (e.key) {
        case "F2":
          e.preventDefault();
          setCheckoutDialogOpen(false);
          setCustomerDialogOpen(false);
          setReceiptOpen(false);
          handlers.focusSearch();
          break;
        case "F4":
          e.preventDefault();
          if (!dialogs.receiptOpen) handlers.openCustomerDialog();
          break;
        case "F8":
          e.preventDefault();
          if (!anyDialogOpen) {
            discountInputRef.current?.focus();
            discountInputRef.current?.select();
          }
          break;
        case "F10":
          e.preventDefault();
          if (dialogs.checkoutDialogOpen) handlers.finalizeSale();
          else if (!anyDialogOpen) handlers.openCheckout();
          break;
        case "Escape":
          // Dialogs handle their own Esc; outside them, Esc clears the search
          if (!anyDialogOpen) {
            setSearchQuery("");
            setShowSuggestions(false);
          }
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    // Celular/tablet: colunas empilhadas; desktop: terminal na altura da tela (main tem p-8)
    <div className="flex flex-col gap-4 lg:h-[calc(100svh-4rem)] lg:flex-row">
      {/* Terminal ocupa a tela toda: título só para leitores de tela */}
      <h1 className="sr-only">Frente de Caixa (PDV)</h1>
      {/* LEFT: Product Search + Cart */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {/* Search Bar */}
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2" />
          <Input
            ref={searchInputRef}
            aria-label="Buscar produto"
            placeholder="Buscar produto por nome, código de barras ou SKU... (F2 · Enter para adicionar)"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={handleSearchKeyDown}
            className="h-12 pl-10 text-base"
          />

          {/* Suggestions Dropdown */}
          {showSuggestions && filteredProducts.length > 0 && (
            <div className="bg-popover absolute top-full right-0 left-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border shadow-xl">
              {filteredProducts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="hover:bg-muted/70 flex w-full items-center justify-between border-b px-4 py-3 text-left text-sm transition-colors last:border-0"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addToCart(p);
                  }}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="text-muted-foreground flex items-center gap-2 text-xs">
                      {p.barcode && <span>EAN: {p.barcode}</span>}
                      {p.sku && <span>SKU: {p.sku}</span>}
                      <span className={cn(p.currentStock <= 0 && "text-destructive font-medium")}>
                        Estoque: {formatQuantity(p.currentStock, p.unit)} {p.unit}
                      </span>
                    </div>
                  </div>
                  <span className="text-primary ml-4 font-bold whitespace-nowrap">
                    {formatCurrency(p.salePrice)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {notice && (
          <div
            role="alert"
            className="border-warning/30 bg-warning/10 text-warning flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{notice}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => setNotice(null)}
              aria-label="Fechar aviso"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {/* Cart Table */}
        <Card className="flex min-h-72 flex-1 flex-col overflow-hidden lg:min-h-0">
          <CardContent className="flex-1 overflow-auto p-0">
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                <ShoppingCart className="text-muted-foreground/30 mb-4 h-16 w-16" />
                <h3 className="text-muted-foreground text-lg font-semibold">Carrinho Vazio</h3>
                <p className="text-muted-foreground/70 mt-1 max-w-xs text-sm">
                  {products.length === 0
                    ? "Nenhum produto disponível. Cadastre produtos ou verifique a conexão com o banco de dados."
                    : "Busque e adicione produtos usando o campo acima ou um leitor de código de barras."}
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr className="text-muted-foreground border-b text-xs">
                    <th className="p-3 text-left font-medium">Produto</th>
                    <th className="w-36 p-3 text-center font-medium">Qtd</th>
                    <th className="p-3 text-right font-medium">Unitário</th>
                    <th className="p-3 text-right font-medium">Subtotal</th>
                    <th className="w-10 p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map((item) => (
                    <tr
                      key={item.productId}
                      className="hover:bg-muted/30 border-b transition-colors"
                    >
                      <td className="min-w-40 p-3">
                        <div className="font-medium">{item.name}</div>
                        <div className="text-muted-foreground text-[11px]">
                          {item.barcode && <>EAN: {item.barcode} · </>}
                          {item.unit}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="icon-xs"
                            variant="outline"
                            aria-label={`Diminuir quantidade de ${item.name}`}
                            onClick={() => updateQuantity(item.productId, -1)}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <QuantityInput item={item} onCommit={setQuantity} />
                          <Button
                            size="icon-xs"
                            variant="outline"
                            aria-label={`Aumentar quantidade de ${item.name}`}
                            onClick={() => updateQuantity(item.productId, 1)}
                            disabled={item.quantity + 1 > item.maxStock}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                      <td className="text-muted-foreground p-3 text-right">
                        {formatCurrency(item.unitPrice)}
                      </td>
                      <td className="p-3 text-right font-semibold">
                        {formatCurrency(item.subtotal)}
                      </td>
                      <td className="p-3">
                        <IconButton
                          size="icon-xs"
                          label={`Remover ${item.name}`}
                          onClick={() => removeItem(item.productId)}
                        >
                          <X className="text-destructive h-3.5 w-3.5" />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* RIGHT: Summary Sidebar */}
      <div className="flex w-full flex-col gap-4 lg:w-80 lg:shrink-0">
        {/* Customer */}
        <Card>
          <CardContent className="space-y-2 p-4">
            <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Cliente
            </h3>
            {selectedCustomer ? (
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <div className="font-medium">{selectedCustomer.name}</div>
                  {selectedCustomer.document && (
                    <div className="text-muted-foreground text-xs">{selectedCustomer.document}</div>
                  )}
                </div>
                <IconButton
                  size="icon-xs"
                  label="Remover cliente da venda"
                  onClick={() => setSelectedCustomer(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full gap-1.5 text-xs"
                onClick={openCustomerDialog}
              >
                <UserRound className="h-4 w-4" />
                Selecionar Cliente (F4)
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Totals */}
        <Card className="flex-1">
          <CardContent className="flex h-full flex-col justify-between p-4">
            <div className="space-y-3">
              <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                Resumo
              </h3>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Itens no carrinho:</span>
                  <span className="font-medium">{cart.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal:</span>
                  <span className="font-medium">{formatCurrency(subtotal)}</span>
                </div>

                {/* Discount Input */}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground shrink-0 text-sm">Desconto R$ (F8):</span>
                  <Input
                    ref={discountInputRef}
                    aria-label="Desconto em reais"
                    type="number"
                    step="0.01"
                    min="0"
                    max={subtotal}
                    value={effectiveDiscount || ""}
                    onChange={(e) =>
                      setDiscount(
                        roundMoney(
                          Math.min(Math.max(parseFloat(e.target.value) || 0, 0), subtotal),
                        ),
                      )
                    }
                    className="h-7 text-right text-xs"
                  />
                </div>
              </div>

              {/* Total Highlighted */}
              <div className="border-t pt-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-lg font-bold">TOTAL</span>
                  <span className="text-primary text-2xl font-extrabold">
                    {formatCurrency(total)}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-4 space-y-2">
              <Button
                className="h-12 w-full gap-2 text-base"
                onClick={openCheckout}
                disabled={cart.length === 0}
              >
                <DollarSign className="h-5 w-5" />
                Finalizar Venda (F10)
              </Button>

              <Button
                variant="destructive"
                className="w-full gap-2"
                onClick={clearCart}
                disabled={cart.length === 0}
              >
                <Trash2 className="h-4 w-4" />
                Limpar Carrinho
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Keyboard Shortcuts Legend */}
        <Card>
          <CardContent className="space-y-2 p-4">
            <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
              <Keyboard className="h-3.5 w-3.5" />
              Atalhos
            </h3>
            <ul className="grid grid-cols-1 gap-1 text-xs">
              {shortcuts.map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{s.label}</span>
                  <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                    {s.key}
                  </kbd>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* CUSTOMER SELECTION DIALOG */}
      <Dialog open={customerDialogOpen} onOpenChange={setCustomerDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <UserRound className="text-primary h-5 w-5" />
              <DialogTitle>Selecionar Cliente</DialogTitle>
            </div>
            <DialogDescription>
              Vincule um cliente à venda ou deixe como &quot;Consumidor Final&quot;.
            </DialogDescription>
          </DialogHeader>

          <Input
            aria-label="Buscar cliente"
            placeholder="Buscar por nome, CPF/CNPJ..."
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
          />

          <div className="max-h-60 space-y-1.5 overflow-y-auto">
            <button
              type="button"
              className="hover:bg-muted/70 flex w-full items-center justify-between rounded-lg border p-2.5 text-left text-sm transition-colors"
              onClick={() => {
                setSelectedCustomer(null);
                setCustomerDialogOpen(false);
              }}
            >
              <span className="text-muted-foreground italic">Consumidor Final (sem vínculo)</span>
            </button>
            {filteredCustomers.map((c) => (
              <button
                key={c.id}
                type="button"
                className="hover:bg-muted/70 flex w-full items-center justify-between rounded-lg border p-2.5 text-left text-sm transition-colors"
                onClick={() => {
                  setSelectedCustomer(c);
                  setCustomerDialogOpen(false);
                }}
              >
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-muted-foreground text-xs">
                    {c.document || "Sem documento"} {c.phone ? `· ${c.phone}` : ""}
                  </div>
                </div>
              </button>
            ))}
            {filteredCustomers.length === 0 && customerSearch && (
              <p className="text-muted-foreground py-4 text-center text-xs">
                Nenhum cliente encontrado para &quot;{customerSearch}&quot;.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* CHECKOUT / PAYMENT DIALOG */}
      <Dialog open={checkoutDialogOpen} onOpenChange={setCheckoutDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <ReceiptText className="text-primary h-5 w-5" />
              <DialogTitle>Finalizar Venda</DialogTitle>
            </div>
            <DialogDescription>Confirme a forma de pagamento e finalize a venda.</DialogDescription>
          </DialogHeader>

          {error && (
            <div className="text-destructive bg-destructive/10 border-destructive/20 rounded-md border p-2.5 text-xs">
              {error}
            </div>
          )}

          {needsCustomer && (
            <div className="border-warning/30 bg-warning/10 text-warning flex items-center justify-between gap-2 rounded-md border p-2.5 text-xs">
              <span>Venda no Fiado exige um cliente vinculado.</span>
              <Button size="xs" variant="outline" onClick={openCustomerDialog}>
                Selecionar (F4)
              </Button>
            </div>
          )}

          {/* Total Display */}
          <div className="bg-muted/50 rounded-lg py-3 text-center">
            <p className="text-muted-foreground text-xs">Total a Pagar</p>
            <p className="text-primary text-3xl font-extrabold">{formatCurrency(total)}</p>
            {selectedCustomer && (
              <p className="text-muted-foreground mt-1 text-xs">Cliente: {selectedCustomer.name}</p>
            )}
          </div>

          {/* Payment Method Selection */}
          <div className="space-y-2">
            <p id="pdv-forma-pagamento" className="text-foreground text-xs font-medium">
              Forma de Pagamento
            </p>
            <div
              role="group"
              aria-labelledby="pdv-forma-pagamento"
              className="grid grid-cols-3 gap-2"
            >
              {paymentMethods.map((pm) => {
                const Icon = pm.icon;
                const isActive = selectedPayment === pm.key;
                return (
                  <button
                    key={pm.key}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setSelectedPayment(pm.key)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border p-3 text-xs font-medium transition-all",
                      isActive
                        ? "border-primary bg-primary/10 text-primary ring-primary/30 ring-2"
                        : "border-border hover:bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {pm.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Amount Paid (only for cash) */}
          {selectedPayment === "MONEY" && (
            <div className="space-y-2">
              <Label
                htmlFor="pdv-terminal-valor-recebido-r"
                className="text-foreground text-xs font-medium"
              >
                Valor Recebido (R$)
              </Label>
              <Input
                id="pdv-terminal-valor-recebido-r"
                type="number"
                step="0.01"
                min={0}
                value={amountPaid || ""}
                onChange={(e) => setAmountPaid(parseFloat(e.target.value) || 0)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") finalizeSale();
                }}
                className="h-11 text-right font-mono text-lg font-semibold"
                autoFocus
              />
              {amountPaid >= total && (
                <div className="border-success/30 bg-success/10 flex items-center justify-between rounded-md border p-2">
                  <span className="text-success text-sm font-medium">Troco:</span>
                  <span className="text-success text-lg font-bold">{formatCurrency(change)}</span>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setCheckoutDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={finalizeSale} disabled={loading || needsCustomer} className="gap-2">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Processando...
                </>
              ) : (
                <>
                  <DollarSign className="h-4 w-4" /> Confirmar Venda (F10)
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RECEIPT MODAL */}
      <ReceiptModal
        open={receiptOpen}
        onOpenChange={(open) => {
          setReceiptOpen(open);
          if (!open) focusSearch();
        }}
        sale={completedSale}
        storeSettings={storeSettings}
      />
    </div>
  );
}
