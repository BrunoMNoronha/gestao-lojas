// Copia o binário do leitor ZXing (fallback do BarcodeDetector, issue #21) para public/, para que
// a leitura pela câmera não dependa de CDN de terceiros. Roda no postinstall; o destino é ignorado
// pelo git e o nome leva a versão do zxing-wasm para invalidar cache a cada atualização.
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
// zxing-wasm é dependência do barcode-detector (não direta): resolve a partir dele
const fromBarcodeDetector = createRequire(require.resolve("barcode-detector"));
const source = fromBarcodeDetector.resolve("zxing-wasm/reader/zxing_reader.wasm");
const { ZXING_WASM_VERSION } = await import("barcode-detector/ponyfill");

const targetDir = join(process.cwd(), "public", "vendor", "zxing");
const target = join(targetDir, `zxing_reader-${ZXING_WASM_VERSION}.wasm`);

mkdirSync(targetDir, { recursive: true });
for (const file of readdirSync(targetDir)) rmSync(join(targetDir, file));
copyFileSync(source, target);
console.log(`[copy-zxing-wasm] ${target}`);
