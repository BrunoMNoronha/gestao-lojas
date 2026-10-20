// Leitura de código de barras pela câmera (issue #21): detecção de recurso e criação do detector.
// Usa o BarcodeDetector nativo quando ele cobre os formatos de varejo; caso contrário carrega o
// ponyfill (ZXing em WebAssembly) sob demanda, servindo o .wasm pelo próprio app.
import type { BarcodeFormat, DetectedBarcode } from "barcode-detector/ponyfill";

// Formatos impressos em embalagens e etiquetas de varejo
export const RETAIL_BARCODE_FORMATS: BarcodeFormat[] = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "itf",
];

export interface BarcodeReader {
  detect(source: HTMLVideoElement): Promise<Pick<DetectedBarcode, "rawValue" | "format">[]>;
  native: boolean;
}

export type CameraErrorKind =
  "insecure" | "unsupported" | "denied" | "no-camera" | "in-use" | "unknown";

export const CAMERA_ERROR_MESSAGES: Record<
  CameraErrorKind,
  { title: string; description: string }
> = {
  insecure: {
    title: "Câmera indisponível nesta conexão",
    description:
      "O navegador só libera a câmera em páginas seguras (HTTPS). Acesse o sistema pelo endereço com HTTPS ou digite o código.",
  },
  unsupported: {
    title: "Navegador sem suporte à câmera",
    description: "Este navegador não permite usar a câmera. Digite o código ou use um leitor USB.",
  },
  denied: {
    title: "Acesso à câmera negado",
    description:
      "Libere a câmera para este site nas configurações do navegador (ícone ao lado do endereço) e tente novamente.",
  },
  "no-camera": {
    title: "Nenhuma câmera encontrada",
    description: "Este aparelho não tem câmera disponível. Digite o código ou use um leitor USB.",
  },
  "in-use": {
    title: "Câmera em uso",
    description: "Outro aplicativo ou aba está usando a câmera. Feche-o e tente novamente.",
  },
  unknown: {
    title: "Não foi possível abrir a câmera",
    description: "Tente novamente. Se o problema continuar, digite o código.",
  },
};

// Mostra o botão de câmera quando ela pode ser usada, ou quando a página está em HTTP (para explicar
// por que não funciona). Fora disso (sem getUserMedia em contexto seguro), o botão fica oculto.
export function isCameraScanAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return !!navigator.mediaDevices?.getUserMedia || !window.isSecureContext;
}

export function cameraErrorKind(error: unknown): CameraErrorKind {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "denied";
    case "NotFoundError":
    case "OverconstrainedError":
      return "no-camera";
    case "NotReadableError":
    case "AbortError":
      return "in-use";
    default:
      return "unknown";
  }
}

interface NativeBarcodeDetector {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
interface NativeBarcodeDetectorConstructor {
  new (options: { formats: string[] }): NativeBarcodeDetector;
  getSupportedFormats(): Promise<string[]>;
}

async function createReader(): Promise<BarcodeReader> {
  const Native = (globalThis as { BarcodeDetector?: NativeBarcodeDetectorConstructor })
    .BarcodeDetector;
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats();
      if (RETAIL_BARCODE_FORMATS.every((format) => supported.includes(format))) {
        const detector = new Native({ formats: RETAIL_BARCODE_FORMATS });
        return { detect: (source) => detector.detect(source), native: true };
      }
    } catch {
      // Implementação nativa incompleta: segue para o ponyfill
    }
  }

  const { BarcodeDetector, ZXING_WASM_VERSION, prepareZXingModule } =
    await import("barcode-detector/ponyfill");
  // .wasm copiado para public/ no postinstall (scripts/copy-zxing-wasm.mjs)
  await prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith(".wasm")
          ? `/vendor/zxing/zxing_reader-${ZXING_WASM_VERSION}.wasm`
          : prefix + path,
    },
    fireImmediately: true,
  });
  const detector = new BarcodeDetector({ formats: RETAIL_BARCODE_FORMATS });
  return { detect: (source) => detector.detect(source), native: false };
}

// Um único detector por carregamento de página (o .wasm é baixado só na primeira abertura)
let readerPromise: Promise<BarcodeReader> | null = null;

export function getBarcodeReader(): Promise<BarcodeReader> {
  readerPromise ??= createReader().catch((error) => {
    readerPromise = null;
    throw error;
  });
  return readerPromise;
}
