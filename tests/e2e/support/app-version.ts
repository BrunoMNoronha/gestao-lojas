import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Versão nova do app nos testes de navegador (ver mock-app-version.mjs, carregado no servidor).
// O arquivo é lido a cada pedido do /serwist/sw.js: existir = versão nova publicada.

export const APP_VERSION_FILE = path.join(tmpdir(), "gestao-lojas-e2e", "app-version.txt");

/** Publica uma versão nova: o próximo /serwist/sw.js sai com outra revisão das páginas. */
export function publishNewAppVersion(version: string) {
  mkdirSync(path.dirname(APP_VERSION_FILE), { recursive: true });
  writeFileSync(APP_VERSION_FILE, version);
}

/** Volta a servir o Service Worker do build. */
export function restoreAppVersion() {
  rmSync(APP_VERSION_FILE, { force: true });
}
