"use client";

import { useSyncExternalStore } from "react";

// Estado da paleta de comandos (Ctrl/Cmd+K) num módulo, sem provider: qualquer botão pode
// abri-la e o PDV consulta se ela está aberta para não reagir aos próprios atalhos por baixo.
let open = false;
// Fica true até o fim do evento que fechou a paleta (ex.: o Esc), para o PDV não tratá-lo também
let closing = false;
const listeners = new Set<() => void>();

function getSnapshot() {
  return open;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setCommandPaletteOpen(next: boolean) {
  if (open === next) return;
  open = next;
  if (!next) {
    closing = true;
    setTimeout(() => {
      closing = false;
    }, 0);
  }
  listeners.forEach((listener) => listener());
}

export function openCommandPalette() {
  setCommandPaletteOpen(true);
}

export function isCommandPaletteOpen() {
  return open || closing;
}

export function useCommandPaletteOpen() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
