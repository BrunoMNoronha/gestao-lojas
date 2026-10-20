// Preload do servidor nos testes de navegador (NODE_OPTIONS=--import): simula a publicação de uma
// versão nova do app sem refazer o build. Enquanto o arquivo indicado em E2E_APP_VERSION_FILE
// existir, o /serwist/sw.js é servido com outra revisão das páginas guardadas (/pdv e /offline),
// como num deploy novo: o navegador encontra um Service Worker diferente e o instala.
//
// O Playwright não consegue interceptar essa requisição: quem busca o script do Service Worker é
// o próprio navegador, fora da página. Nenhum código de teste entra no produto.
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";

const VERSION_FILE = process.env.E2E_APP_VERSION_FILE;
const SW_PATH = "/serwist/sw.js";
// Script gerado pelo build (src/app/serwist/[path]/route.ts)
const SW_BUILD = ".next/server/app/serwist/sw.js.body";
const PAGE_REVISION = /revision:"[^"]*",url:"\/(pdv|offline)"/g;

const originalEmit = http.Server.prototype.emit;

http.Server.prototype.emit = function (event, req, res, ...rest) {
  if (
    event === "request" &&
    VERSION_FILE &&
    req.url?.split("?")[0] === SW_PATH &&
    existsSync(VERSION_FILE)
  ) {
    const version = readFileSync(VERSION_FILE, "utf8").trim();
    const original = readFileSync(SW_BUILD, "utf8");
    const script = original.replace(
      PAGE_REVISION,
      (_, page) => `revision:"${version}",url:"/${page}"`,
    );
    if (script === original) {
      res.writeHead(500).end("Revisão das páginas não encontrada no Service Worker do build.");
      return true;
    }
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    });
    res.end(script);
    return true;
  }
  return originalEmit.call(this, event, req, res, ...rest);
};
