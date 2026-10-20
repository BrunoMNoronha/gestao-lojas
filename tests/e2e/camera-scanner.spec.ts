import { expect, test } from "@playwright/test";
import { resetDatabase, seedStore, snapshot, type Store } from "./support/db";
import { CAMERA_BARCODE } from "./support/fake-camera";
import {
  confirmCheckout,
  expectQueue,
  goOffline,
  goOnline,
  login,
  preparePdv,
  readQueue,
  searchBox,
  takeReceipt,
} from "./support/pdv";

// Leitor de código de barras pela câmera sem rede (issues #21 e #39, docs/OFFLINE.md seção 6.1).
// O navegador usa uma câmera falsa que mostra o EAN-13 do arroz (support/fake-camera.ts). Sem o
// BarcodeDetector nativo (Windows e Linux), a leitura usa o ZXing em WebAssembly, que precisa vir
// do cache do Service Worker.

const ZXING_WASM = /\/vendor\/zxing\/zxing_reader-[\d.]+\.wasm/;

let store: Store;

test.beforeEach(async () => {
  await resetDatabase();
  store = await seedStore();
});

test("sem rede, a câmera lê o código e a venda segue pela fila", async ({ context, page }) => {
  await login(context, store.seller.email);
  await preparePdv(page);

  // O WASM do leitor (nome com a versão) já está guardado pelo Service Worker
  expect(
    await page.evaluate(async (pattern) => {
      const regex = new RegExp(pattern);
      for (const name of await caches.keys()) {
        const requests = await (await caches.open(name)).keys();
        if (requests.some((r) => regex.test(new URL(r.url).pathname))) return true;
      }
      return false;
    }, ZXING_WASM.source),
  ).toBe(true);

  // Página aberta do zero sem rede: nada do leitor foi carregado antes
  await goOffline(context, page);
  await page.reload();
  await expect(searchBox(page)).toBeVisible();

  const native = await page.evaluate(() => "BarcodeDetector" in globalThis);
  const wasm: { fromServiceWorker: boolean; status: number }[] = [];
  const wasmFailures: string[] = [];
  page.on("response", (response) => {
    if (ZXING_WASM.test(response.url())) {
      wasm.push({ fromServiceWorker: response.fromServiceWorker(), status: response.status() });
    }
  });
  page.on("requestfailed", (request) => {
    if (ZXING_WASM.test(request.url())) wasmFailures.push(request.url());
  });

  await page.getByRole("button", { name: "Ler código pela câmera" }).click();
  const scanner = page.getByRole("dialog", { name: "Ler produtos pela câmera" });
  await expect(scanner).toBeVisible();
  await expect(page.getByText(`Arroz 5kg adicionado (${CAMERA_BARCODE}).`)).toBeVisible({
    timeout: 30_000,
  });
  // O código continua na frente da câmera: conta uma vez só
  await page.waitForTimeout(2_000);
  await scanner.getByRole("button", { name: "Concluir" }).click();
  await expect(scanner).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Quantidade de Arroz 5kg" })).toHaveValue("1");
  expect(wasmFailures).toEqual([]);
  // Sem leitor nativo, o WASM veio do cache do Service Worker
  if (!native) expect(wasm).toEqual([{ fromServiceWorker: true, status: 200 }]);

  await confirmCheckout(page, "PIX");
  const receipt = await takeReceipt(page);
  expect(receipt).toContain("PROVISÓRIA");
  expect(receipt).toContain("Arroz 5kg");
  await expect.poll(() => readQueue(page, store.seller.id)).toMatchObject([{ status: "pending" }]);

  await goOnline(context, page);
  await expectQueue(page, store.seller.id, ["synced"]);
  expect(await snapshot(store)).toMatchObject({
    sales: 1,
    items: 1,
    operations: 1,
    rice: "9.000",
    cashSalesTotal: "10.00",
  });
});
