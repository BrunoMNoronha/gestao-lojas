import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Câmera falsa do Chromium para o leitor de código de barras (issue #39). O navegador é aberto com
// --use-file-for-fake-video-capture apontando para um vídeo Y4M gerado aqui, com um código EAN-13
// desenhado no centro. Gerado no global-setup (o projeto não tem ffmpeg nem arquivo binário de
// teste no repositório).

// Código de barras do arroz em seedStore (tests/e2e/support/db.ts)
export const CAMERA_BARCODE = "7891234567895";
export const CAMERA_VIDEO = path.join(tmpdir(), "gestao-lojas-e2e", `camera-${CAMERA_BARCODE}.y4m`);

const WIDTH = 640;
const HEIGHT = 480;
const FRAMES = 2;
// Quantos pixels de largura tem cada barra fina (módulo)
const MODULE_PX = 4;
const BAR_HEIGHT = 260;
const BLACK = 16;
const WHITE = 235;

// Codificação dos dígitos do EAN-13 (ISO/IEC 15420): R é o inverso de L, e G é R de trás para frente
const L_CODES =
  "0001101 0011001 0010011 0111101 0100011 0110001 0101111 0111011 0110111 0001011".split(" ");
const R_CODES = L_CODES.map((code) => code.replace(/[01]/g, (bit) => (bit === "0" ? "1" : "0")));
const G_CODES = R_CODES.map((code) => [...code].reverse().join(""));
// Paridade (L ou G) dos seis dígitos da esquerda, definida pelo primeiro dígito
const PARITY = "LLLLLL LLGLGG LLGGLG LLGGGL LGLLGG LGGLLG LGGGLL LGLGLG LGLGGL LGGLGL".split(" ");

/** Barras do EAN-13 ("1" = barra preta), 95 módulos. */
export function ean13Modules(code: string): string {
  if (!/^\d{13}$/.test(code)) throw new Error(`EAN-13 inválido: ${code}`);
  const digits = [...code].map(Number);
  const sum = digits.slice(0, 12).reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  if ((10 - (sum % 10)) % 10 !== digits[12]) throw new Error(`Dígito verificador errado: ${code}`);

  const parity = PARITY[digits[0]];
  const left = digits
    .slice(1, 7)
    .map((d, i) => (parity[i] === "L" ? L_CODES[d] : G_CODES[d]))
    .join("");
  const right = digits
    .slice(7)
    .map((d) => R_CODES[d])
    .join("");
  return `101${left}01010${right}101`;
}

/** Grava o vídeo Y4M (4:2:0, fundo branco) com o código no centro e devolve o caminho. */
export function writeBarcodeVideo(code = CAMERA_BARCODE, file = CAMERA_VIDEO): string {
  const modules = ean13Modules(code);
  const luma = Buffer.alloc(WIDTH * HEIGHT, WHITE);
  const left = Math.floor((WIDTH - modules.length * MODULE_PX) / 2);
  const top = Math.floor((HEIGHT - BAR_HEIGHT) / 2);
  for (let y = top; y < top + BAR_HEIGHT; y++) {
    for (let m = 0; m < modules.length; m++) {
      if (modules[m] !== "1") continue;
      luma.fill(BLACK, y * WIDTH + left + m * MODULE_PX, y * WIDTH + left + (m + 1) * MODULE_PX);
    }
  }
  // Sem cor: as duas camadas de crominância ficam no valor neutro
  const chroma = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2) * 2, 128);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), luma, chroma]);
  const header = Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F30:1 Ip A1:1 C420jpeg\n`);

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.concat([header, ...Array<Buffer>(FRAMES).fill(frame)]));
  return file;
}
