"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CameraOff, Loader2, ScanBarcode, SwitchCamera } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconButton } from "@/components/icon-button";
import {
  CAMERA_ERROR_MESSAGES,
  type CameraErrorKind,
  cameraErrorKind,
  getBarcodeReader,
  isCameraScanAvailable,
} from "@/lib/barcode-scanner";
import { cn } from "@/lib/utils";

// Mesmo código lido de novo dentro desta janela é ignorado (evita somar o item em dobro)
const REPEAT_WINDOW_MS = 1500;
const SCAN_INTERVAL_MS = 120;

interface BarcodeScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetected: (code: string) => void;
  // Contínuo: o diálogo fica aberto e cada leitura dispara onDetected (PDV)
  continuous?: boolean;
  title?: string;
  description?: string;
}

export function BarcodeScannerDialog({
  open,
  onOpenChange,
  onDetected,
  continuous = false,
  title = "Ler código de barras",
  description = "Aponte a câmera para o código de barras do produto.",
}: BarcodeScannerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanBarcode className="text-primary size-5" aria-hidden />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {/* Montado só com o diálogo aberto: ao fechar, a câmera é liberada */}
        <ScannerView
          active={open}
          continuous={continuous}
          onDetected={onDetected}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function subscribeVisibility(callback: () => void) {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}

type ScanStatus = "starting" | "scanning" | CameraErrorKind;

function ScannerView({
  active,
  continuous,
  onDetected,
  onClose,
}: {
  active: boolean;
  continuous: boolean;
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const onCloseRef = useRef(onClose);
  const lastSeenRef = useRef<{ code: string; at: number } | null>(null);

  const [status, setStatus] = useState<ScanStatus>("starting");
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [readCount, setReadCount] = useState(0);

  // Aba oculta: libera a câmera e reabre ao voltar
  const pageVisible = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );

  // Ambiente sem câmera utilizável (HTTP ou navegador sem getUserMedia): sem efeito a executar
  const envError: CameraErrorKind | null = !window.isSecureContext
    ? "insecure"
    : typeof navigator.mediaDevices?.getUserMedia === "function"
      ? null
      : "unsupported";

  useEffect(() => {
    onDetectedRef.current = onDetected;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!active || !pageVisible || envError) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const video = videoRef.current;

    const stop = () => {
      cancelled = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      if (video) video.srcObject = null;
    };

    const handleCodes = (codes: { rawValue: string }[]) => {
      const code = codes.map((c) => c.rawValue.trim()).find(Boolean);
      if (!code) return;

      const now = Date.now();
      const last = lastSeenRef.current;
      if (last && last.code === code && now - last.at < REPEAT_WINDOW_MS) {
        last.at = now; // código ainda na frente da câmera: continua ignorando
        return;
      }
      lastSeenRef.current = { code, at: now };

      navigator.vibrate?.(80);
      setLastCode(code);
      setReadCount((n) => n + 1);
      onDetectedRef.current(code);

      if (!continuous) {
        stop();
        onCloseRef.current();
      }
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId } }
            : { facingMode: { ideal: "environment" } },
        });
      } catch (error) {
        if (!cancelled) setStatus(cameraErrorKind(error));
        return;
      }
      if (cancelled || !video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setCurrentDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? null);

      // Os nomes das câmeras só ficam disponíveis depois da permissão
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      if (cancelled) return;
      setCameras(devices.filter((d) => d.kind === "videoinput"));

      let reader;
      try {
        reader = await getBarcodeReader();
      } catch (error) {
        console.error("Falha ao carregar o leitor de código de barras:", error);
        if (!cancelled) setStatus("unknown");
        return;
      }
      if (cancelled) return;
      setStatus("scanning");

      const tick = async () => {
        if (cancelled) return;
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          try {
            handleCodes(await reader.detect(video));
          } catch {
            // Quadro ilegível: tenta no próximo
          }
        }
        if (!cancelled) timer = setTimeout(tick, SCAN_INTERVAL_MS);
      };
      tick();
    })();

    return stop;
  }, [active, pageVisible, envError, deviceId, attempt, continuous]);

  const errorKind = envError ?? (status !== "starting" && status !== "scanning" ? status : null);
  const error = errorKind ? CAMERA_ERROR_MESSAGES[errorKind] : null;

  const switchCamera = () => {
    if (cameras.length < 2) return;
    const index = cameras.findIndex((c) => c.deviceId === currentDeviceId);
    setDeviceId(cameras[(index + 1) % cameras.length].deviceId);
  };

  const retry = () => {
    setStatus("starting");
    setAttempt((n) => n + 1);
  };

  return (
    <>
      {error ? (
        <div className="flex flex-col items-center rounded-lg border p-6 text-center" role="alert">
          <div className="bg-destructive/10 text-destructive mb-3 rounded-full p-3">
            <CameraOff className="size-6" aria-hidden />
          </div>
          <p className="font-semibold">{error.title}</p>
          <p className="text-muted-foreground mt-1 text-sm">{error.description}</p>
        </div>
      ) : (
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-black">
          <video
            ref={videoRef}
            className="absolute inset-0 size-full object-cover"
            playsInline
            muted
            aria-hidden
          />
          {/* Mira: faixa central onde o código deve ficar */}
          <div className="pointer-events-none absolute inset-x-[10%] top-1/2 h-1/3 -translate-y-1/2 rounded-md border-2 border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" />
          {status === "starting" && (
            <div className="absolute inset-0 flex items-center justify-center text-white">
              <Loader2 className="size-8 animate-spin" aria-hidden />
            </div>
          )}
          {cameras.length > 1 && (
            <IconButton
              label="Trocar câmera"
              variant="secondary"
              size="icon"
              className="absolute top-2 right-2"
              onClick={switchCamera}
            >
              <SwitchCamera />
            </IconButton>
          )}
        </div>
      )}

      <p
        aria-live="polite"
        className={cn("text-center text-sm", lastCode ? "font-medium" : "text-muted-foreground")}
      >
        {error
          ? null
          : status === "starting"
            ? "Abrindo a câmera…"
            : lastCode
              ? `Lido: ${lastCode}${continuous ? ` · ${readCount} ${readCount === 1 ? "leitura" : "leituras"}` : ""}`
              : "Procurando código de barras…"}
      </p>

      <DialogFooter>
        {errorKind && errorKind !== "insecure" && errorKind !== "unsupported" && (
          <Button variant="outline" onClick={retry}>
            Tentar novamente
          </Button>
        )}
        <Button variant={continuous && readCount > 0 ? "default" : "outline"} onClick={onClose}>
          {continuous && readCount > 0 ? "Concluir" : "Fechar"}
        </Button>
      </DialogFooter>
    </>
  );
}

function subscribeNothing() {
  return () => {};
}

interface ScanBarcodeButtonProps {
  onDetected: (code: string) => void;
  continuous?: boolean;
  label?: string;
  title?: string;
  description?: string;
  size?: React.ComponentProps<typeof IconButton>["size"];
  variant?: React.ComponentProps<typeof IconButton>["variant"];
  className?: string;
}

// Botão "Ler código pela câmera" + diálogo. Oculto quando não há como usar a câmera
// (exceto em HTTP, em que aparece para explicar o motivo).
export function ScanBarcodeButton({
  onDetected,
  continuous,
  label = "Ler código pela câmera",
  title,
  description,
  size = "icon",
  variant = "outline",
  className,
}: ScanBarcodeButtonProps) {
  const available = useSyncExternalStore(subscribeNothing, isCameraScanAvailable, () => false);
  const [open, setOpen] = useState(false);

  if (!available) return null;

  return (
    <>
      <IconButton
        type="button"
        label={label}
        size={size}
        variant={variant}
        className={className}
        onClick={() => setOpen(true)}
      >
        <ScanBarcode />
      </IconButton>
      <BarcodeScannerDialog
        open={open}
        onOpenChange={setOpen}
        onDetected={onDetected}
        continuous={continuous}
        title={title}
        description={description}
      />
    </>
  );
}
