import { tmpdir } from "node:os";
import path from "node:path";

// Câmera falsa do vídeo da landing: mostra o EAN-13 do café da loja de demonstração. O arquivo é
// gerado ao carregar playwright.screenshots.config.ts, antes de o navegador abrir.
export const SCAN_BARCODE = "7891234567895";
export const SCAN_VIDEO = path.join(tmpdir(), "gestao-lojas-landing", `camera-${SCAN_BARCODE}.y4m`);
