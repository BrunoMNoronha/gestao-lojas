import { describe, expect, it, vi } from "vitest";
import { createInstallStore, detectInstallPlatform, type InstallWindow } from "@/lib/pwa-install";

// Estado da oferta de instalação (issue #61): o evento do navegador é guardado, abre a janela uma
// única vez e só depois de pedido; aceitar a janela não conta como instalado.

function fakeWindow({ standalone = false, iosStandalone = false } = {}) {
  const target = new EventTarget();
  const mediaListeners: (() => void)[] = [];
  const media = {
    matches: standalone,
    addEventListener: (_: "change", listener: () => void) => mediaListeners.push(listener),
  };
  const win: InstallWindow = {
    addEventListener: (type, listener) => target.addEventListener(type, listener),
    matchMedia: () => media,
    navigator: { standalone: iosStandalone },
  };
  return {
    win,
    dispatch: (event: Event) => target.dispatchEvent(event),
    setStandalone(value: boolean) {
      media.matches = value;
      mediaListeners.forEach((listener) => listener());
    },
  };
}

function installPromptEvent(outcome: "accepted" | "dismissed" | Error = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: string }>;
  };
  event.prompt = vi.fn(async () => {
    if (outcome instanceof Error) throw outcome;
  });
  event.userChoice =
    outcome instanceof Error ? new Promise(() => {}) : Promise.resolve({ outcome });
  return event;
}

describe("createInstallStore", () => {
  it("sem o evento do navegador, não há janela para abrir", async () => {
    const { win } = fakeWindow();
    const store = createInstallStore(win);
    expect(store.getState()).toMatchObject({ canPrompt: false, standalone: false });
    expect(await store.prompt()).toBe("unavailable");
  });

  it("guarda o evento, impede a janela automática e abre uma única vez", async () => {
    const { win, dispatch } = fakeWindow();
    const store = createInstallStore(win);
    const listener = vi.fn();
    store.subscribe(listener);
    const event = installPromptEvent("accepted");
    dispatch(event);

    expect(event.defaultPrevented).toBe(true);
    expect(store.getState().canPrompt).toBe(true);
    expect(listener).toHaveBeenCalled();

    expect(await store.prompt()).toBe("accepted");
    expect(event.prompt).toHaveBeenCalledTimes(1);
    // Evento usado: descartado; aceitar não é o mesmo que instalado
    expect(store.getState()).toMatchObject({
      canPrompt: false,
      prompting: false,
      installed: false,
    });
    expect(await store.prompt()).toBe("unavailable");
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it("dois cliques seguidos abrem a janela só uma vez", async () => {
    const { win, dispatch } = fakeWindow();
    const store = createInstallStore(win);
    const event = installPromptEvent("dismissed");
    dispatch(event);

    const [first, second] = await Promise.all([store.prompt(), store.prompt()]);
    expect(first).toBe("dismissed");
    expect(second).toBe("unavailable");
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it("recusa e erro não deixam evento guardado nem janela presa", async () => {
    const { win, dispatch } = fakeWindow();
    const store = createInstallStore(win);

    dispatch(installPromptEvent("dismissed"));
    expect(await store.prompt()).toBe("dismissed");
    expect(store.getState()).toMatchObject({ canPrompt: false, prompting: false });

    dispatch(installPromptEvent(new Error("NotAllowedError")));
    expect(await store.prompt()).toBe("error");
    expect(store.getState()).toMatchObject({ canPrompt: false, prompting: false });
  });

  it("um novo evento do navegador volta a oferecer a janela", async () => {
    const { win, dispatch } = fakeWindow();
    const store = createInstallStore(win);
    dispatch(installPromptEvent("dismissed"));
    await store.prompt();
    dispatch(installPromptEvent("accepted"));
    expect(store.getState().canPrompt).toBe(true);
  });

  it("appinstalled marca o app como instalado e descarta o evento", async () => {
    const { win, dispatch } = fakeWindow();
    const store = createInstallStore(win);
    dispatch(installPromptEvent());
    dispatch(new Event("appinstalled"));
    expect(store.getState()).toMatchObject({ installed: true, canPrompt: false });
    expect(await store.prompt()).toBe("unavailable");
  });

  it("reconhece o app aberto como instalado (display-mode e iOS)", () => {
    expect(createInstallStore(fakeWindow({ standalone: true }).win).getState().standalone).toBe(
      true,
    );
    expect(createInstallStore(fakeWindow({ iosStandalone: true }).win).getState().standalone).toBe(
      true,
    );

    const fake = fakeWindow();
    const store = createInstallStore(fake.win);
    fake.setStandalone(true);
    expect(store.getState().standalone).toBe(true);
  });
});

describe("detectInstallPlatform", () => {
  it.each([
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      0,
      "ios",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
      5,
      "ios",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
      0,
      "mac-safari",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36",
      5,
      "android",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0",
      0,
      "desktop-chromium",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
      0,
      "firefox",
    ],
    ["Mozilla/5.0 (X11; Linux x86_64) SomeBrowser/1.0", 0, "other"],
  ])("%s", (userAgent, touchPoints, expected) => {
    expect(detectInstallPlatform(userAgent, touchPoints)).toBe(expected);
  });
});
