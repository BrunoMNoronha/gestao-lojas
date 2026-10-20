"use client";

import { useSyncExternalStore } from "react";
import {
  MAX_ORDER_ITEMS,
  validQuantity,
  type CatalogUnit,
  type OrderLine,
} from "@/lib/catalog-shared";

// Carrinho do catálogo público (#17), por navegador, em localStorage. É só uma sugestão do
// cliente: itens, preços e disponibilidade são recalculados no servidor ao enviar o pedido.

export interface CartLine {
  productId: string;
  name: string;
  price: number;
  unit: CatalogUnit;
  imageUrl: string | null;
  quantity: number;
}

export interface CartProduct {
  id: string;
  name: string;
  price: number;
  unit: CatalogUnit;
  imageUrl: string | null;
}

const STORAGE_KEY = "gestao-lojas:catalogo:carrinho:v1";
const UNITS: CatalogUnit[] = ["UN", "KG", "LT", "CX", "M"];
const EMPTY: CartLine[] = [];

let lines: CartLine[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function isCartLine(value: unknown): value is CartLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.productId === "string" &&
    typeof line.name === "string" &&
    typeof line.price === "number" &&
    UNITS.includes(line.unit as CatalogUnit) &&
    (line.imageUrl === null || typeof line.imageUrl === "string") &&
    validQuantity(line.unit as CatalogUnit, line.quantity) !== null
  );
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    lines = Array.isArray(parsed) ? parsed.filter(isCartLine).slice(0, MAX_ORDER_ITEMS) : EMPTY;
  } catch {
    lines = EMPTY;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

// Mantém abas abertas do catálogo sincronizadas
function onStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY) return;
  loaded = false;
  load();
  emit();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot() {
  load();
  return lines;
}

function getServerSnapshot() {
  return EMPTY;
}

function save(next: CartLine[]) {
  lines = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Navegação privada ou armazenamento cheio: o carrinho vale só nesta aba
  }
  emit();
}

export function useCart(): CartLine[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

const noopSubscribe = () => () => {};

/** false no servidor e na hidratação; true depois (o carrinho só existe no navegador). */
export function useCartReady(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function lineSubtotal(line: { price: number; quantity: number }): number {
  return Math.round(line.price * line.quantity * 100) / 100;
}

export function cartTotal(cart: CartLine[]): number {
  return Math.round(cart.reduce((sum, line) => sum + lineSubtotal(line), 0) * 100) / 100;
}

export type AddResult = "added" | "updated" | "full" | "invalid";

export const cartActions = {
  add(product: CartProduct, quantity: number): AddResult {
    load();
    const existing = lines.find((line) => line.productId === product.id);
    const nextQuantity = validQuantity(product.unit, (existing?.quantity ?? 0) + quantity);
    if (nextQuantity === null) return "invalid";
    const line: CartLine = {
      productId: product.id,
      name: product.name,
      price: product.price,
      unit: product.unit,
      imageUrl: product.imageUrl,
      quantity: nextQuantity,
    };
    if (existing) {
      save(lines.map((item) => (item.productId === product.id ? line : item)));
      return "updated";
    }
    if (lines.length >= MAX_ORDER_ITEMS) return "full";
    save([...lines, line]);
    return "added";
  },

  setQuantity(productId: string, quantity: number): boolean {
    load();
    const line = lines.find((item) => item.productId === productId);
    const valid = line ? validQuantity(line.unit, quantity) : null;
    if (!line || valid === null) return false;
    save(lines.map((item) => (item.productId === productId ? { ...item, quantity: valid } : item)));
    return true;
  },

  remove(productId: string) {
    load();
    save(lines.filter((item) => item.productId !== productId));
  },

  clear() {
    save(EMPTY);
  },

  /** Aplica o resultado do servidor: preços e nomes atuais; remove os itens recusados. */
  sync(items: OrderLine[], removedIds: string[]): CartLine[] {
    load();
    const current = new Map(items.map((item) => [item.productId, item]));
    const next = lines
      .filter((line) => !removedIds.includes(line.productId))
      .map((line) => {
        const item = current.get(line.productId);
        return item
          ? {
              ...line,
              name: item.name,
              price: item.price,
              unit: item.unit,
              quantity: item.quantity,
            }
          : line;
      });
    save(next);
    return next;
  },
};
