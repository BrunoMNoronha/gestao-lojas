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
  WifiOff,
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
import { refreshUnpackProducts, type ProductItem } from "@/actions/products";
import { openPdvBoxes } from "@/actions/unpack";
import {
  StockUnpackDialog,
  readPendingStockUnpack,
  usePendingStockUnpack,
  type StoredUnpackOperation,
  type UnpackSuccessData,
} from "@/components/stock-unpack-dialog";
import { suggestUnpack, type UnpackSuggestion } from "@/lib/unpack-suggestion";
import { checkConnectivity } from "@/lib/offline/sync";
import type { UnpackInput, UnpackResult } from "@/lib/unpack";
import { CustomerItem } from "@/actions/customers";
import { StoreSettingsData } from "@/actions/settings";
import { createSale } from "@/actions/sales";
import { ReceiptModal, CompletedSale } from "@/components/receipt-modal";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { IconButton } from "@/components/icon-button";
import { ScanBarcodeButton } from "@/components/barcode-scanner-dialog";
import { toast } from "sonner";
import { MoneyInput } from "@/components/money-input";
import { displayDocument, displayPhone, matchesMaskedValue } from "@/lib/masks";
import { formatStoreDate, storeDueDate } from "@/lib/store-time";
import { newOperationId } from "@/lib/operation-id";
import {
  lineSubtotal,
  type PdvSaleDraft,
  type SubmitSaleResult,
} from "@/lib/offline/sale-operation";
import type { CartDraftInput, RestoredCart } from "@/lib/offline/cart-draft";

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

// Gravações seguidas do rascunho do carrinho viram uma só (não trava a digitação)
const DRAFT_SAVE_DELAY_MS = 300;

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

// Campos que o terminal usa: vêm do servidor (/admin/pdv) ou da cópia local (/pdv, issue #37)
export type PdvProduct = Pick<
  ProductItem,
  "id" | "name" | "sku" | "barcode" | "salePrice" | "unit" | "currentStock"
> & { containedProductId?: string | null; unitsPerBox?: number | null };

export interface PdvUnpackControls {
  prepare: () => Promise<PdvProduct[]>;
  confirm: (input: UnpackInput) => Promise<UnpackResult>;
  refresh: (data: UnpackSuccessData) => Promise<PdvProduct[]>;
  pending?: {
    boxProductId: string;
    unitProductId: string;
    input: UnpackInput;
    boxName: string;
    unitName: string;
    data?: UnpackSuccessData;
  } | null;
}
export type PdvCustomer = Pick<CustomerItem, "id" | "name" | "document" | "phone">;

function recoverySuggestion(
  products: PdvProduct[],
  stored: StoredUnpackOperation,
): UnpackSuggestion<PdvProduct> {
  const input = stored.input;
  const box = products.find((p) => p.id === input.boxProductId);
  const unit = products.find((p) => p.id === input.expectedUnitProductId);
  return {
    boxProduct: box ?? {
      id: input.boxProductId,
      name: stored.boxName,
      unit: "CX",
      currentStock: 0,
      sku: null,
      barcode: null,
      salePrice: 0,
      containedProductId: input.expectedUnitProductId,
      unitsPerBox: input.expectedUnitsPerBox,
    },
    unitProduct: unit ?? {
      id: input.expectedUnitProductId,
      name: stored.unitName,
      unit: "UN",
      currentStock: 0,
      sku: null,
      barcode: null,
      salePrice: 0,
    },
    boxQuantity: input.boxQuantity,
    reservedBoxes: input.reservedBoxes ?? 0,
  };
}

interface PdvTerminalProps {
  products: PdvProduct[];
  customers: PdvCustomer[];
  storeSettings: StoreSettingsData;
  cashRegisterId: string;
  // PDV sem conexão com o servidor (/pdv): só avisa; a venda vai para a fila do aparelho
  offline?: boolean;
  // Grava a venda por outro caminho (/pdv: fila do aparelho, issue #38). Sem ela, a venda vai
  // ao servidor pelo createSale, com as regras online
  submitSale?: (draft: PdvSaleDraft) => Promise<SubmitSaleResult>;
  // Depois da venda: por padrão recarrega os dados da página (router.refresh)
  onSaleCompleted?: () => void;
  // Carrinho em montagem guardado no aparelho (/pdv, issue #53): começa pelo rascunho já
  // conferido com a cópia local e grava cada mudança. Sem ela, o carrinho fica só na memória
  cartDraft?: {
    restored: RestoredCart | null;
    // O que mudou no carrinho guardado (ou por que foi descartado)
    notices: string[];
    save: (draft: CartDraftInput | null) => Promise<void>;
  };
  unpackScope?: string;
  // /pdv só abre caixas online após enviar a fila e atualizar os saldos, sem enfileirar abertura.
  unpack?: PdvUnpackControls;
  onUnpackBusyChange?: (busy: boolean) => void;
  className?: string;
}

export function PdvTerminal({
  products: suppliedProducts,
  customers,
  storeSettings,
  cashRegisterId,
  offline = false,
  submitSale,
  onSaleCompleted,
  cartDraft,
  unpackScope = `pdv:${cashRegisterId}`,
  unpack,
  onUnpackBusyChange,
  className,
}: PdvTerminalProps) {
  const router = useRouter();
  const [freshProducts, setFreshProducts] = useState<{
    source: PdvProduct[];
    products: PdvProduct[];
  } | null>(null);
  const products =
    freshProducts?.source === suppliedProducts ? freshProducts.products : suppliedProducts;
  const storedUnpack = usePendingStockUnpack(unpackScope);
  const persistedUnpack = storedUnpack ?? unpack?.pending ?? null;
  const [recoveryDismissed, setRecoveryDismissed] = useState(false);
  const [unpackBusy, setUnpackBusy] = useState(false);
  const unpackWorking = useRef(false);
  const [unpackSuggestion, setUnpackSuggestion] = useState<UnpackSuggestion<PdvProduct> | null>(
    null,
  );
  const [unpackRefreshBlocked, setUnpackRefreshBlocked] = useState(false);
  const requestedAfterUnpack = useRef<{ productId: string; quantity: number } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const discountInputRef = useRef<HTMLInputElement>(null);

  // Carrinho guardado no aparelho (só o estado inicial; depois, o terminal manda)
  const restored = cartDraft?.restored ?? null;

  // Cart state
  const [cart, setCart] = useState<CartItem[]>(() => restored?.items ?? []);
  const [discount, setDiscount] = useState(() => restored?.discount ?? 0);
  const [notice, setNotice] = useState<string | null>(() =>
    cartDraft?.notices.length ? cartDraft.notices.join(" ") : null,
  );

  // Search & product suggestions
  const [searchQuery, setSearchQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Customer selection
  const [selectedCustomer, setSelectedCustomer] = useState<PdvCustomer | null>(() =>
    restored?.customer ? (customers.find((c) => c.id === restored.customer!.id) ?? null) : null,
  );
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");

  // Payment / Checkout
  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState(() => !!restored?.checkout);
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethodKey>(
    () => restored?.checkout?.paymentMethod ?? "MONEY",
  );
  const [amountPaid, setAmountPaid] = useState(() => restored?.checkout?.amountPaid ?? 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Chave da tentativa de venda (issue #35): reaproveitada nos reenvios da mesma venda, para
  // que o servidor nunca grave duas vezes; muda quando o carrinho ou o pagamento mudam.
  const pendingOperation = useRef<{ id: string; signature: string } | null>(
    restored?.operation ?? null,
  );

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

  // Fiado desligado nas Configurações da Loja: a forma some (o servidor também recusa)
  const onAccountDueDays = storeSettings.onAccountDueDays ?? null;
  const availablePaymentMethods =
    storeSettings.onAccountEnabled === false
      ? paymentMethods.filter((pm) => pm.key !== "ON_ACCOUNT")
      : paymentMethods;

  // Focus search on mount and after sale
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Rascunho do carrinho (issue #53): cada mudança é gravada depois de uma pausa curta; esvaziar
  // o carrinho apaga na hora. Falha ao gravar não bloqueia a venda: avisa uma vez.
  const saveDraft = cartDraft?.save;
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Rascunho ainda não gravado (undefined: nada pendente; null: apagar)
  const unsavedDraft = useRef<CartDraftInput | null | undefined>(undefined);
  const draftFailed = useRef(false);

  const writeDraft = useCallback(
    async (draft: CartDraftInput | null) => {
      if (!saveDraft) return;
      try {
        await saveDraft(draft);
        draftFailed.current = false;
      } catch (err) {
        console.error("Falha ao guardar o carrinho no aparelho:", err);
        if (!draftFailed.current) {
          draftFailed.current = true;
          toast.warning(
            "Não foi possível guardar o carrinho neste aparelho. A venda funciona normalmente, mas o carrinho se perde se a página recarregar.",
          );
        }
      }
    },
    [saveDraft],
  );

  const flushDraft = useCallback(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    const draft = unsavedDraft.current;
    unsavedDraft.current = undefined;
    return draft === undefined ? Promise.resolve() : writeDraft(draft);
  }, [writeDraft]);

  const draftOf = useCallback(
    (): CartDraftInput | null =>
      cart.length === 0 && !selectedCustomer
        ? null
        : {
            items: cart.map(({ productId, name, unit, barcode, quantity, unitPrice }) => ({
              productId,
              name,
              unit,
              barcode,
              quantity,
              unitPrice,
            })),
            customer: selectedCustomer
              ? {
                  id: selectedCustomer.id,
                  name: selectedCustomer.name,
                  document: selectedCustomer.document,
                }
              : null,
            discount,
            checkout: checkoutDialogOpen ? { paymentMethod: selectedPayment, amountPaid } : null,
            operation: pendingOperation.current,
          },
    [cart, selectedCustomer, discount, checkoutDialogOpen, selectedPayment, amountPaid],
  );

  // Carrinho restaurado sem mudanças já está gravado: regravar renovaria a validade de 12 h, que
  // conta da última mudança feita pelo operador
  const skipFirstSave = useRef(!!restored && !cartDraft?.notices.length);
  useEffect(() => {
    if (!saveDraft) return;
    if (skipFirstSave.current) {
      skipFirstSave.current = false;
      return;
    }
    const draft = draftOf();
    unsavedDraft.current = draft;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    if (draft === null) void flushDraft();
    else draftTimer.current = setTimeout(() => void flushDraft(), DRAFT_SAVE_DELAY_MS);
  }, [saveDraft, draftOf, flushDraft]);

  // Ao sair da tela (troca de painel, encerramento), grava o que estiver pendente
  const flushOnUnmount = useRef(flushDraft);
  useEffect(() => {
    flushOnUnmount.current = flushDraft;
  }, [flushDraft]);
  useEffect(() => () => void flushOnUnmount.current(), []);

  // Carrinho restaurado sem mudanças: avisa de leve (as mudanças ficam no aviso fixo)
  const restoredOnMount = useRef(!!restored && !cartDraft?.notices.length);
  useEffect(() => {
    if (restoredOnMount.current) toast.info("Carrinho da venda em andamento restaurado.");
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
          matchesMaskedValue(c.document, q) ||
          matchesMaskedValue(c.phone, q)
        );
      })
    : customers;

  const activeUnpackSuggestion =
    unpackSuggestion ??
    (!recoveryDismissed && persistedUnpack ? recoverySuggestion(products, persistedUnpack) : null);
  const interactionBlocked =
    unpackBusy || unpackRefreshBlocked || !!persistedUnpack || !!activeUnpackSuggestion;
  const interactionBlockedRef = useRef(interactionBlocked);
  useEffect(() => {
    interactionBlockedRef.current = interactionBlocked;
    onUnpackBusyChange?.(interactionBlocked);
    return () => onUnpackBusyChange?.(false);
  }, [interactionBlocked, onUnpackBusyChange]);

  const updateProducts = (next: PdvProduct[]) => {
    setFreshProducts({ source: suppliedProducts, products: next });
    setCart((current) =>
      current.map((item) => ({
        ...item,
        maxStock: next.find((p) => p.id === item.productId)?.currentStock ?? 0,
      })),
    );
  };

  const applyQuantity = (product: PdvProduct, quantity: number) => {
    setCart((previous) => {
      const existing = previous.find((item) => item.productId === product.id);
      if (quantity <= 0) return previous.filter((item) => item.productId !== product.id);
      if (existing)
        return previous.map((item) =>
          item.productId === product.id
            ? {
                ...item,
                quantity,
                maxStock: product.currentStock,
                subtotal: lineSubtotal(quantity, item.unitPrice),
              }
            : item,
        );
      return [
        ...previous,
        {
          productId: product.id,
          name: product.name,
          unit: product.unit,
          barcode: product.barcode,
          quantity,
          unitPrice: product.salePrice,
          subtotal: lineSubtotal(quantity, product.salePrice),
          maxStock: product.currentStock,
        },
      ];
    });
  };

  const prepareUnpack = async (): Promise<PdvProduct[]> => {
    if (unpack) return unpack.prepare();
    const connection = await checkConnectivity();
    if (connection.status !== "online")
      throw new Error("Abrir uma caixa exige conexão com o servidor.");
    const result = await refreshUnpackProducts();
    if (!result.success) throw new Error(result.error);
    return result.products;
  };

  const recoverUnpack = () => {
    if (!persistedUnpack) {
      setNotice(
        "Não foi possível recuperar a abertura pendente. Confira a operação no módulo Estoque antes de continuar.",
      );
      return;
    }
    setRecoveryDismissed(false);
    setUnpackSuggestion(recoverySuggestion(products, persistedUnpack));
  };

  const beginUnpack = async (productId: string, quantity: number) => {
    if (offline || unpackWorking.current || interactionBlockedRef.current || loading) return;
    unpackWorking.current = true;
    setUnpackBusy(true);
    try {
      const next = await prepareUnpack();
      updateProducts(next);
      const unit = next.find((p) => p.id === productId);
      if (unit && quantity <= unit.currentStock) {
        applyQuantity(unit, quantity);
        setNotice(null);
        return;
      }
      const suggestion = suggestUnpack(next, productId, quantity, cart);
      if (!suggestion)
        throw new Error(
          "Não há caixas disponíveis para essa quantidade após conferir o estoque e as caixas no carrinho.",
        );
      requestedAfterUnpack.current = { productId, quantity };
      setUnpackSuggestion(suggestion);
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível preparar a abertura.");
    } finally {
      unpackWorking.current = false;
      setUnpackBusy(false);
    }
  };

  const confirmUnpack = async (input: UnpackInput): Promise<UnpackResult> => {
    unpackWorking.current = true;
    setUnpackBusy(true);
    setUnpackRefreshBlocked(true);
    try {
      if (!unpack) updateProducts(await prepareUnpack());
      const result = unpack ? await unpack.confirm(input) : await openPdvBoxes(input);
      if (!result.success && !result.uncertain) setUnpackRefreshBlocked(false);
      return result;
    } finally {
      unpackWorking.current = false;
      setUnpackBusy(false);
    }
  };

  const refreshAfterUnpack = async (data: UnpackSuccessData) => {
    unpackWorking.current = true;
    setUnpackBusy(true);
    try {
      const next = unpack ? await unpack.refresh(data) : await prepareUnpack();
      updateProducts(next);
      const target = requestedAfterUnpack.current;
      const product = target && next.find((p) => p.id === target.productId);
      if (target && product && target.quantity <= product.currentStock) {
        applyQuantity(product, target.quantity);
        setNotice(null);
      } else if (target) {
        setNotice(
          "A caixa foi aberta. Confira a quantidade disponível antes de adicionar o produto.",
        );
      }
      requestedAfterUnpack.current = null;
      setUnpackRefreshBlocked(false);
      router.refresh();
    } finally {
      unpackWorking.current = false;
      setUnpackBusy(false);
    }
  };

  // Busca, leitura por código e botões passam pela mesma regra de estoque e sugestão.
  const addToCart = (
    product: PdvProduct,
    { focusSearch = true }: { focusSearch?: boolean } = {},
  ) => {
    if (interactionBlockedRef.current || unpackWorking.current || loading)
      return "Aguarde a conferência da abertura da caixa.";
    const nextQuantity = (cart.find((item) => item.productId === product.id)?.quantity ?? 0) + 1;
    let error: string | null = null;
    if (nextQuantity > product.currentStock) {
      if (!offline && suggestUnpack(products, product.id, nextQuantity, cart)) {
        void beginUnpack(product.id, nextQuantity);
        error = "Confirme a abertura da caixa para adicionar as unidades avulsas.";
      } else {
        error = `Estoque insuficiente para "${product.name}" (disponível: ${formatQuantity(product.currentStock, product.unit)} ${product.unit}).`;
        setNotice(error);
      }
    } else {
      applyQuantity(product, nextQuantity);
      setNotice(null);
    }
    setSearchQuery("");
    setShowSuggestions(false);
    if (focusSearch) searchInputRef.current?.focus();
    return error;
  };

  // Regra do Enter (e da leitura pela câmera): código de barras ou SKU exato; senão, o único
  // produto cujo nome, código ou SKU contenha o termo
  const resolveProduct = (query: string): PdvProduct | "none" | "many" => {
    const q = query.trim().toLowerCase();
    const exact = products.find(
      (p) => p.barcode?.toLowerCase() === q || p.sku?.toLowerCase() === q,
    );
    if (exact) return exact;
    const matches = products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.barcode?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q),
    );
    if (matches.length === 1) return matches[0];
    return matches.length === 0 ? "none" : "many";
  };

  // Leitura pela câmera (modo contínuo): cada código lido adiciona um item
  const handleScannedCode = (code: string) => {
    const result = resolveProduct(code);
    if (result === "none") {
      toast.error(`Nenhum produto encontrado para o código ${code}.`);
    } else if (result === "many") {
      toast.warning(`Mais de um produto corresponde a ${code}. Use a busca para escolher.`);
    } else {
      const error = addToCart(result, { focusSearch: false });
      if (error) toast.error(error);
      else toast.success(`${result.name} adicionado (${code}).`);
    }
  };

  // Handle barcode/enter from search
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      const result = resolveProduct(searchQuery);
      if (result === "none") {
        setNotice(`Nenhum produto encontrado para "${searchQuery.trim()}".`);
      } else if (result !== "many") {
        addToCart(result);
      }
    }
  };

  // Aumento pela quantidade digitada também pode propor a abertura mínima.
  const setQuantity = (productId: string, requested: number) => {
    if (interactionBlockedRef.current || unpackWorking.current || loading) return;
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const quantity = roundQuantity(requested, product.unit);
    if (quantity > product.currentStock) {
      if (!offline && suggestUnpack(products, productId, quantity, cart))
        void beginUnpack(productId, quantity);
      else
        setNotice(
          `Estoque insuficiente para "${product.name}" (disponível: ${formatQuantity(product.currentStock, product.unit)} ${product.unit}).`,
        );
      return;
    }
    applyQuantity(product, quantity);
    setNotice(null);
  };

  const updateQuantity = (productId: string, delta: number) => {
    const item = cart.find((i) => i.productId === productId);
    if (item) setQuantity(productId, item.quantity + delta);
  };

  // Remove item
  const removeItem = (productId: string) => {
    if (interactionBlockedRef.current || unpackWorking.current || loading) return;
    setCart((prev) => prev.filter((item) => item.productId !== productId));
    setNotice(null);
  };

  const focusSearch = () => {
    // Defer so it runs after any dialog finishes closing and releases focus
    setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  // Clear cart
  const clearCart = () => {
    if (interactionBlockedRef.current || unpackWorking.current) return;
    setCart([]);
    setDiscount(0);
    setSelectedCustomer(null);
    setError(null);
    setNotice(null);
    focusSearch();
  };

  const openCustomerDialog = () => {
    if (interactionBlockedRef.current || unpackWorking.current || loading) return;
    setCheckoutDialogOpen(false);
    setCustomerSearch("");
    setCustomerDialogOpen(true);
  };

  // Open checkout
  const openCheckout = () => {
    if (cart.length === 0 || interactionBlockedRef.current || unpackWorking.current || loading)
      return;
    setAmountPaid(total);
    setSelectedPayment("MONEY");
    setError(null);
    setCheckoutDialogOpen(true);
  };

  // Finalize sale
  const finalizeSale = async () => {
    if (cart.length === 0 || loading || interactionBlockedRef.current || unpackWorking.current)
      return;
    if (
      cart.some(
        (item) =>
          item.quantity > (products.find((p) => p.id === item.productId)?.currentStock ?? 0),
      )
    ) {
      setError("O estoque mudou. Confira as quantidades do carrinho antes de confirmar a venda.");
      return;
    }

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

    const payload = {
      cashRegisterId,
      customerId: selectedCustomer?.id || null,
      paymentMethod: selectedPayment,
      discount: effectiveDiscount,
      amountPaid: selectedPayment === "MONEY" ? amountPaid : undefined,
      items: cart.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      })),
    };
    const signature = JSON.stringify(payload);
    if (pendingOperation.current?.signature !== signature) {
      pendingOperation.current = { id: newOperationId(), signature };
    }

    if (submitSale) {
      // O rascunho guarda a chave antes de a venda ser gravada: se a página cair no meio, o
      // carrinho volta com a mesma chave e a nova tentativa nunca vira uma segunda venda. A venda
      // apaga o rascunho na mesma transação em que é gravada
      if (saveDraft) {
        unsavedDraft.current = undefined;
        if (draftTimer.current) clearTimeout(draftTimer.current);
        draftTimer.current = null;
        await writeDraft(draftOf());
      }
      await finalizeWith(submitSale, pendingOperation.current.id);
      return;
    }

    let res: Awaited<ReturnType<typeof createSale>>;
    try {
      res = await createSale({ operationId: pendingOperation.current.id, ...payload });
    } catch (err) {
      // The action call itself failed (network drop, server unreachable, deploy
      // mid-request). The server may have committed before the response was lost;
      // retrying the same cart reuses the operation key, so it never records twice.
      console.error("Falha ao chamar createSale:", err);
      setError(
        "Não foi possível confirmar a venda. Verifique a conexão e tente de novo sem alterar o carrinho: o reenvio não duplica a venda.",
      );
      return;
    } finally {
      setLoading(false);
    }

    if (res.success && res.data) {
      completeSale(res.data as CompletedSale);
    } else {
      setError(res.error || "Erro ao processar a venda.");
    }
  };

  const completeSale = (sale: CompletedSale) => {
    pendingOperation.current = null;
    setCompletedSale(sale);
    setCheckoutDialogOpen(false);
    setReceiptOpen(true);
    clearCart();
    if (onSaleCompleted) onSaleCompleted();
    else if (!submitSale) router.refresh();
  };

  // Venda pela fila do aparelho (/pdv): o recibo só aparece depois de a venda estar gravada;
  // se a gravação falhar (ex.: sem espaço), o carrinho fica como está
  const finalizeWith = async (
    submit: (draft: PdvSaleDraft) => Promise<SubmitSaleResult>,
    operationId: string,
  ) => {
    let res: SubmitSaleResult;
    try {
      res = await submit({
        operationId,
        customer: selectedCustomer
          ? {
              id: selectedCustomer.id,
              name: selectedCustomer.name,
              document: selectedCustomer.document,
            }
          : null,
        paymentMethod: selectedPayment,
        discount: effectiveDiscount,
        amountPaid: selectedPayment === "MONEY" ? amountPaid : undefined,
        items: cart.map((item) => ({
          productId: item.productId,
          name: item.name,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      });
    } catch (err) {
      console.error("Falha ao registrar a venda:", err);
      res = { success: false, error: "Não foi possível registrar a venda neste aparelho." };
    } finally {
      setLoading(false);
    }
    if (res.success) completeSale(res.sale);
    else setError(res.error);
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
      if (interactionBlockedRef.current || unpackWorking.current) return;
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
    <>
      {(unpackBusy || unpackRefreshBlocked || !!persistedUnpack) && (
        <div
          role="status"
          className="border-warning/30 bg-warning/10 mb-4 flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
        >
          {unpackBusy
            ? "Conferindo a abertura e atualizando os saldos. Aguarde..."
            : "Verifique a abertura pendente e atualize os saldos antes de continuar a venda."}
          {!unpackBusy && !activeUnpackSuggestion && (
            <Button variant="outline" size="sm" onClick={recoverUnpack}>
              Verificar abertura pendente
            </Button>
          )}
        </div>
      )}
      {/* Celular/tablet: colunas empilhadas; desktop: terminal na altura da tela (main tem p-8) */}
      <div
        inert={interactionBlocked}
        aria-busy={unpackBusy}
        className={cn("flex flex-col gap-4 lg:h-[calc(100svh-4rem)] lg:flex-row", className)}
      >
        {/* Terminal ocupa a tela toda: título só para leitores de tela */}
        <h1 className="sr-only">Frente de Caixa (PDV)</h1>
        {/* LEFT: Product Search + Cart */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Search Bar */}
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
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
                          <span
                            className={cn(p.currentStock <= 0 && "text-destructive font-medium")}
                          >
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
            <ScanBarcodeButton
              continuous
              className="size-12"
              title="Ler produtos pela câmera"
              description="Cada código lido adiciona um item ao carrinho. Afaste o código e aproxime de novo para somar outra unidade."
              onDetected={handleScannedCode}
            />
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
                              disabled={
                                item.quantity + 1 > item.maxStock &&
                                (offline ||
                                  !suggestUnpack(products, item.productId, item.quantity + 1, cart))
                              }
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
                      <div className="text-muted-foreground text-xs">
                        {displayDocument(selectedCustomer.document)}
                      </div>
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
                    <span className="text-muted-foreground shrink-0 text-sm">
                      Desconto R$ (F8):
                    </span>
                    <MoneyInput
                      ref={discountInputRef}
                      aria-label="Desconto em reais"
                      value={effectiveDiscount || null}
                      onValueChange={(value) =>
                        setDiscount(roundMoney(Math.min(Math.max(value ?? 0, 0), subtotal)))
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
                {offline && (
                  <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
                    <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    Sem conexão: a venda fica guardada neste aparelho e é enviada quando a conexão
                    voltar.
                  </p>
                )}
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
                      {displayDocument(c.document) || "Sem documento"}{" "}
                      {c.phone ? `· ${displayPhone(c.phone)}` : ""}
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
              <DialogDescription>
                Confirme a forma de pagamento e finalize a venda.
              </DialogDescription>
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
                <p className="text-muted-foreground mt-1 text-xs">
                  Cliente: {selectedCustomer.name}
                </p>
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
                {availablePaymentMethods.map((pm) => {
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

            {selectedPayment === "ON_ACCOUNT" && onAccountDueDays !== null && (
              <p className="text-muted-foreground text-xs" suppressHydrationWarning>
                Vencimento do título: {formatStoreDate(storeDueDate(onAccountDueDays))} (
                {onAccountDueDays === 1 ? "1 dia" : `${onAccountDueDays} dias`}).
              </p>
            )}

            {/* Amount Paid (only for cash) */}
            {selectedPayment === "MONEY" && (
              <div className="space-y-2">
                <Label
                  htmlFor="pdv-terminal-valor-recebido-r"
                  className="text-foreground text-xs font-medium"
                >
                  Valor Recebido (R$)
                </Label>
                <MoneyInput
                  id="pdv-terminal-valor-recebido-r"
                  value={amountPaid || null}
                  onValueChange={(value) => setAmountPaid(value ?? 0)}
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

        {activeUnpackSuggestion && (
          <StockUnpackDialog
            key={`${unpackScope}:${activeUnpackSuggestion.boxProduct.id}`}
            open
            onOpenChange={(open) => {
              if (open) return;
              setUnpackSuggestion(null);
              setRecoveryDismissed(true);
              requestedAfterUnpack.current = null;
              if (readPendingStockUnpack(unpackScope)) setUnpackRefreshBlocked(true);
            }}
            boxProduct={{
              ...activeUnpackSuggestion.boxProduct,
              containedProductId: activeUnpackSuggestion.boxProduct.containedProductId ?? null,
              unitsPerBox: activeUnpackSuggestion.boxProduct.unitsPerBox ?? null,
            }}
            unitProduct={activeUnpackSuggestion.unitProduct}
            initialQuantity={activeUnpackSuggestion.boxQuantity}
            reservedBoxes={activeUnpackSuggestion.reservedBoxes}
            operationScope={unpackScope}
            initialOperation={persistedUnpack ?? undefined}
            onConfirm={confirmUnpack}
            onSuccess={refreshAfterUnpack}
          />
        )}

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
    </>
  );
}
