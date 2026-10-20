import { describe, expect, it } from "vitest";
import { permissionForPath, routesFor, topbarRoutesFor } from "@/lib/routes";

// Rotas do painel: atalhos da barra superior saem do menu lateral, continuam na paleta e
// respeitam a permissão de cada perfil.
const hrefs = (routes: { href: string }[]) => routes.map((route) => route.href);

describe("rotas da barra superior", () => {
  it("saem do menu lateral e continuam na paleta de comandos", () => {
    const side = hrefs(routesFor("ADMIN"));
    expect(side).not.toContain("/pdv");
    expect(side).not.toContain("/admin/sincronizacao");

    const palette = hrefs(routesFor("ADMIN", {}, { includeTopbar: true }));
    expect(palette).toContain("/pdv");
    expect(palette).toContain("/admin/sincronizacao");
  });

  it("mostram só o que o perfil pode acessar", () => {
    expect(hrefs(topbarRoutesFor("MANAGER"))).toEqual(["/pdv", "/admin/sincronizacao"]);
    expect(hrefs(topbarRoutesFor("SELLER"))).toEqual(["/pdv"]);
    expect(topbarRoutesFor(null)).toEqual([]);
  });

  it("a checagem de acesso das páginas continua valendo", () => {
    expect(permissionForPath("/admin/sincronizacao")).toBe("offline.reconcile");
    expect(permissionForPath("/pdv")).toBe("pdv.use");
  });
});

describe("menu Insights (issue #113)", () => {
  it("aparece para gestão só com a chave da API salva", () => {
    expect(hrefs(routesFor("ADMIN", { aiInsights: true }))).toContain("/admin/insights");
    expect(hrefs(routesFor("MANAGER", { aiInsights: true }))).toContain("/admin/insights");
    expect(hrefs(routesFor("MANAGER", { aiInsights: false }))).not.toContain("/admin/insights");
  });

  it("não aparece para o vendedor, e a página exige insights.view", () => {
    expect(hrefs(routesFor("SELLER", { aiInsights: true }))).not.toContain("/admin/insights");
    expect(permissionForPath("/admin/insights")).toBe("insights.view");
  });
});
