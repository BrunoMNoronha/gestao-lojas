"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PackageOpen, Loader2 } from "lucide-react";
import type { ProductItem } from "@/actions/products";
import { openStockBoxes } from "@/actions/unpack";
import type { UnpackInput, UnpackResult } from "@/lib/unpack";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatQuantity } from "@/lib/stock";
import { toast } from "sonner";

export type UnpackSuccessData = Extract<UnpackResult, { success: true }>["data"];

export interface StoredUnpackOperation {
  input: UnpackInput;
  boxName: string;
  unitName: string;
  data?: UnpackSuccessData;
}

type UnpackBoxProduct = Pick<
  ProductItem,
  "id" | "name" | "unit" | "currentStock" | "containedProductId" | "unitsPerBox"
>;
type UnpackUnitProduct = Pick<ProductItem, "id" | "name" | "unit" | "currentStock">;

interface StockUnpackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boxProduct: UnpackBoxProduct;
  unitProduct: UnpackUnitProduct;
  initialQuantity?: number;
  initialOperation?: StoredUnpackOperation;
  reservedBoxes?: number;
  // Inclui módulo e usuário: stock:<userId> ou pdv:<userId>.
  operationScope: string;
  onConfirm?: (input: UnpackInput) => Promise<UnpackResult>;
  onSuccess?: (data: UnpackSuccessData) => Promise<void> | void;
}

function storageKey(scope: string) {
  return `stock-unpack:${scope}`;
}

const OPERATION_EVENT = "stock-unpack-operation";

function notifyOperationChange() {
  window.dispatchEvent(new Event(OPERATION_EVENT));
}

function subscribeOperationChanges(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(OPERATION_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(OPERATION_EVENT, listener);
  };
}

export function usePendingStockUnpack(scope: string): StoredUnpackOperation | null {
  const stored = useSyncExternalStore(
    subscribeOperationChanges,
    () => {
      try {
        return window.sessionStorage.getItem(storageKey(scope));
      } catch {
        return null;
      }
    },
    () => null,
  );
  return useMemo(() => {
    try {
      return parseStoredOperation(stored);
    } catch {
      return null;
    }
  }, [stored]);
}

function parseStoredOperation(value: string | null): StoredUnpackOperation | null {
  if (!value) return null;
  const parsed = JSON.parse(value) as StoredUnpackOperation;
  if (
    !parsed?.input?.operationId ||
    !parsed.input.boxProductId ||
    !parsed.input.expectedUnitProductId ||
    !Number.isSafeInteger(parsed.input.expectedUnitsPerBox) ||
    parsed.input.expectedUnitsPerBox < 2 ||
    !Number.isSafeInteger(parsed.input.boxQuantity) ||
    parsed.input.boxQuantity < 1 ||
    typeof parsed.boxName !== "string" ||
    typeof parsed.unitName !== "string"
  ) {
    throw new Error("Registro da abertura pendente inválido.");
  }
  return parsed;
}

// O PDV/Estoque usa o mesmo registro para oferecer recuperação após recarregar a página.
// O saldo e a autorização sempre são conferidos novamente no servidor.
export function readPendingStockUnpack(scope: string): StoredUnpackOperation | null {
  if (typeof window === "undefined") return null;
  try {
    return parseStoredOperation(window.sessionStorage.getItem(storageKey(scope)));
  } catch {
    return null;
  }
}

export function StockUnpackDialog({
  open,
  onOpenChange,
  boxProduct,
  unitProduct,
  initialQuantity = 1,
  initialOperation,
  reservedBoxes = 0,
  operationScope,
  onConfirm = openStockBoxes,
  onSuccess,
}: StockUnpackDialogProps) {
  const [pending, setPending] = useState(
    () => readPendingStockUnpack(operationScope) ?? initialOperation ?? null,
  );
  const [quantity, setQuantity] = useState(() =>
    String(pending?.input.boxQuantity ?? initialQuantity),
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const receipt = useRef<UnpackSuccessData | null>(pending?.data ?? null);
  const factor = pending?.input.expectedUnitsPerBox ?? boxProduct.unitsPerBox ?? 0;
  const parsedQuantity = Number(quantity);
  const validQuantity = Number.isSafeInteger(parsedQuantity) && parsedQuantity > 0;
  const unitQuantity = validQuantity ? parsedQuantity * factor : 0;
  const availableBoxes = Math.max(0, boxProduct.currentStock - reservedBoxes);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!busy.current) onOpenChange(nextOpen);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    let prepared = false;
    try {
      const key = storageKey(operationScope);
      // Ler e persistir antes do envio: falha do armazenamento impede uma mutação sem ID recuperável.
      let operation = parseStoredOperation(window.sessionStorage.getItem(key)) ?? pending;
      if (operation && operation.input.boxProductId !== boxProduct.id) {
        setError(`Verifique primeiro a abertura pendente de ${operation.boxName}.`);
        return;
      }
      if (!operation) {
        if (!navigator.onLine) {
          setError("Conecte-se à internet para abrir caixas.");
          return;
        }
        if (!validQuantity || !Number.isSafeInteger(unitQuantity)) {
          setError("Informe uma quantidade inteira de caixas maior que zero.");
          return;
        }
        if (
          boxProduct.unit !== "CX" ||
          unitProduct.unit !== "UN" ||
          boxProduct.containedProductId !== unitProduct.id ||
          factor < 2
        ) {
          setError("O vínculo da caixa com o produto avulso precisa ser atualizado.");
          return;
        }
        if (parsedQuantity > availableBoxes) {
          setError("Não há caixas suficientes após reservar as caixas do carrinho.");
          return;
        }
        operation = {
          input: {
            operationId: crypto.randomUUID(),
            boxProductId: boxProduct.id,
            expectedUnitProductId: unitProduct.id,
            expectedUnitsPerBox: factor,
            boxQuantity: parsedQuantity,
            reservedBoxes,
          },
          boxName: boxProduct.name,
          unitName: unitProduct.name,
        };
      }
      window.sessionStorage.setItem(key, JSON.stringify(operation));
      notifyOperationChange();
      setPending(operation);
      prepared = true;
      let data = receipt.current ?? operation.data;
      if (!data) {
        const result = await onConfirm(operation.input);
        if (!result.success) {
          if (!result.uncertain) {
            window.sessionStorage.removeItem(key);
            notifyOperationChange();
            setPending(null);
          }
          setError(result.error);
          return;
        }
        data = result.data;
        receipt.current = data;
        operation = { ...operation, data };
        setPending(operation);
        // Mesmo se a gravação do recibo falhar, o ID já salvo permite replay sem nova abertura.
        try {
          window.sessionStorage.setItem(key, JSON.stringify(operation));
          notifyOperationChange();
        } catch {
          // O recibo permanece em memória até confirmar a atualização dos saldos.
        }
      }
      await onSuccess?.(data);
      window.sessionStorage.removeItem(key);
      notifyOperationChange();
      toast.success(
        `Abertura registrada: ${data.boxQuantity} caixa(s) e ${data.unitQuantity} unidades avulsas.`,
      );
      onOpenChange(false);
    } catch {
      setError(
        receipt.current
          ? "A abertura já foi registrada. Atualize os saldos antes de continuar; nenhuma caixa será aberta novamente."
          : prepared
            ? "Não foi possível confirmar a abertura. Conecte-se e use Verificar abertura para consultar a mesma operação, sem abrir novas caixas."
            : "Não foi possível guardar a confirmação neste navegador. Verifique se o armazenamento da sessão está disponível e tente novamente.",
      );
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        showCloseButton={!loading}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <PackageOpen className="text-primary h-5 w-5" aria-hidden />
            <DialogTitle>Abrir caixas</DialogTitle>
          </div>
          <DialogDescription>
            Confirme quando as caixas forem fisicamente abertas. As unidades entram no estoque
            imediatamente e continuam disponíveis mesmo se a venda for cancelada.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-destructive bg-destructive/10 rounded-md p-3 text-sm">
            {error}
          </p>
        )}
        {pending && (
          <p role="status" className="bg-info/10 text-info rounded-md p-3 text-sm">
            {pending.data
              ? "Abertura registrada. Falta atualizar os saldos para continuar."
              : "Há uma abertura aguardando confirmação. Verifique a operação antes de abrir outras caixas."}
          </p>
        )}
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="rounded-lg border p-3 text-sm">
            <p className="font-medium">{pending?.boxName ?? boxProduct.name}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              1 caixa gera {factor} unidades de {pending?.unitName ?? unitProduct.name}.
            </p>
            {!pending && (
              <p className="text-muted-foreground mt-1 text-xs">
                Caixas disponíveis: {formatQuantity(availableBoxes, "CX")}
                {reservedBoxes > 0 && ` (${reservedBoxes} reservada(s) no carrinho)`}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="unpack-box-quantity">Quantidade de caixas a abrir</Label>
            <Input
              id="unpack-box-quantity"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              disabled={loading || !!pending}
              required
            />
          </div>
          {validQuantity && (
            <div
              className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm"
              aria-live="polite"
            >
              <div>
                <p className="text-muted-foreground text-xs">Saída de caixas</p>
                <p className="font-mono font-semibold">−{parsedQuantity} CX</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Entrada de avulsas</p>
                <p className="text-success font-mono font-semibold">+{unitQuantity} UN</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={() => handleOpenChange(false)}
            >
              {pending ? "Fechar" : "Cancelar"}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              {loading
                ? "Aguarde..."
                : pending?.data
                  ? "Atualizar saldos"
                  : pending
                    ? "Verificar abertura"
                    : "Confirmar abertura"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
