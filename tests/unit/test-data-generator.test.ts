import { describe, expect, it } from "vitest";
import { isValidCnpj, isValidCpf, normalizePhone } from "@/lib/masks";
import {
  buildTestData,
  createSeededRandom,
  ean13CheckDigit,
  randomCnpj,
  randomCpf,
  randomEan13,
  randomSku,
  TEST_DATA_LIMITS,
  uniqueName,
  uniqueValue,
  validateTestDataCounts,
} from "@/lib/test-data-generator";

// Gerador de dados de teste (issue #57): documentos e códigos válidos, unidades inteiras ou
// fracionadas, preços em centavos, limites e combinações recusadas.

const MAX = { ...TEST_DATA_LIMITS };

describe("validateTestDataCounts", () => {
  it("aceita os tetos e quantidades parciais", () => {
    expect(validateTestDataCounts(MAX)).toEqual({ ok: true, counts: MAX });
    const partial = { categories: 0, products: 0, customers: 3, suppliers: 0 };
    expect(validateTestDataCounts(partial)).toEqual({ ok: true, counts: partial });
  });

  it.each([
    ["acima do teto", { ...MAX, products: MAX.products + 1 }, /produtos/],
    ["negativo", { ...MAX, customers: -1 }, /clientes/],
    ["fracionado", { ...MAX, suppliers: 1.5 }, /fornecedores/],
    ["texto", { ...MAX, categories: "15" }, /categorias/],
    ["campo ausente", { categories: 1, products: 1, customers: 1 }, /fornecedores/],
    ["tudo zero", { categories: 0, products: 0, customers: 0, suppliers: 0 }, /maior que zero/],
    ["produto sem categoria", { ...MAX, categories: 0 }, /categoria e um fornecedor/],
    ["produto sem fornecedor", { ...MAX, suppliers: 0 }, /categoria e um fornecedor/],
  ])("recusa %s", (_, input, message) => {
    const result = validateTestDataCounts(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });

  it("recusa valor que não é objeto", () => {
    expect(validateTestDataCounts(null).ok).toBe(false);
    expect(validateTestDataCounts("50").ok).toBe(false);
  });
});

describe("documentos e códigos", () => {
  const random = createSeededRandom(57);

  it("gera CPF e CNPJ com dígitos verificadores válidos", () => {
    for (let i = 0; i < 200; i++) {
      const cpf = randomCpf(random);
      expect(cpf).toMatch(/^\d{11}$/);
      expect(isValidCpf(cpf)).toBe(true);
      const cnpj = randomCnpj(random);
      expect(cnpj).toMatch(/^\d{8}0001\d{2}$/);
      expect(isValidCnpj(cnpj)).toBe(true);
    }
  });

  it("calcula o dígito do EAN-13 e usa a faixa interna (prefixo 2)", () => {
    // 789100031550-7: código real conhecido
    expect(ean13CheckDigit("789100031550")).toBe(7);
    for (let i = 0; i < 200; i++) {
      const ean = randomEan13(random);
      expect(ean).toMatch(/^2\d{12}$/);
      expect(Number(ean[12])).toBe(ean13CheckDigit(ean.slice(0, 12)));
    }
  });

  it("gera SKU com prefixo TST-", () => {
    expect(randomSku(random)).toMatch(/^TST-[0-9A-Z]{6}$/);
  });

  it("uniqueName acrescenta sufixo numérico em colisão exata", () => {
    expect(uniqueName("Bebidas", new Set())).toBe("Bebidas");
    expect(uniqueName("Bebidas", new Set(["Bebidas"]))).toBe("Bebidas 2");
    expect(uniqueName("Bebidas", new Set(["Bebidas", "Bebidas 2"]))).toBe("Bebidas 3");
    expect(uniqueName("Bebidas", new Set(["bebidas"]))).toBe("Bebidas");
  });

  it("uniqueValue evita valores já usados e desiste depois das tentativas", () => {
    const taken = new Set(["A"]);
    const values = ["A", "A", "B"];
    expect(uniqueValue(() => values.shift()!, taken)).toBe("B");
    expect(taken.has("B")).toBe(true);
    expect(() => uniqueValue(() => "A", taken, 5)).toThrow();
  });
});

describe("buildTestData", () => {
  const data = buildTestData(MAX, createSeededRandom(2026));

  it("respeita as quantidades pedidas", () => {
    expect(data.categories).toHaveLength(MAX.categories);
    expect(data.products).toHaveLength(MAX.products);
    expect(data.customers).toHaveLength(MAX.customers);
    expect(data.suppliers).toHaveLength(MAX.suppliers);
  });

  it("não repete nomes, SKU, códigos de barras nem documentos", () => {
    const distinct = <T>(values: T[]) => new Set(values).size === values.length;
    expect(distinct(data.categories.map((c) => c.name))).toBe(true);
    expect(distinct(data.products.map((p) => p.name))).toBe(true);
    expect(distinct(data.products.map((p) => p.sku))).toBe(true);
    expect(distinct(data.products.map((p) => p.barcode))).toBe(true);
    expect(distinct(data.customers.map((c) => c.name))).toBe(true);
    expect(distinct(data.customers.map((c) => c.document))).toBe(true);
    expect(distinct(data.suppliers.map((s) => s.name))).toBe(true);
    expect(distinct(data.suppliers.map((s) => s.document))).toBe(true);
  });

  it("gera preços com 2 casas, custo positivo e venda acima do custo", () => {
    for (const product of data.products) {
      expect(product.costPrice).toMatch(/^\d+\.\d{2}$/);
      expect(product.salePrice).toMatch(/^\d+\.\d{2}$/);
      expect(Number(product.costPrice)).toBeGreaterThan(0);
      expect(Number(product.salePrice)).toBeGreaterThan(Number(product.costPrice));
    }
  });

  it("usa estoque inteiro em UN/CX e até 3 casas nas demais unidades", () => {
    const units = new Set(data.products.map((p) => p.unit));
    expect(units.size).toBeGreaterThan(2);
    for (const product of data.products) {
      expect(product.initialStock).toMatch(/^\d+\.\d{3}$/);
      expect(product.minStock).toMatch(/^\d+\.\d{3}$/);
      expect(Number(product.initialStock)).toBeGreaterThan(0);
      if (product.unit === "UN" || product.unit === "CX") {
        expect(product.initialStock).toMatch(/\.000$/);
        expect(product.minStock).toMatch(/\.000$/);
      }
    }
  });

  it("liga cada produto a uma categoria e a um fornecedor do próprio conjunto", () => {
    for (const product of data.products) {
      expect(data.categories[product.categoryIndex]).toBeDefined();
      expect(data.suppliers[product.supplierIndex]).toBeDefined();
    }
    // Rodízio: todas as categorias geradas recebem produtos
    expect(new Set(data.products.map((p) => p.categoryIndex)).size).toBe(MAX.categories);
  });

  it("gera clientes com CPF e fornecedores com CNPJ, telefones e e-mails válidos", () => {
    for (const customer of data.customers) {
      expect(isValidCpf(customer.document)).toBe(true);
      expect(customer.phone).toHaveLength(11);
      expect(normalizePhone(customer.phone)).toEqual({ ok: true, value: customer.phone });
      expect(customer.email).toMatch(/^[a-z0-9.]+@exemplo\.test$/);
    }
    for (const supplier of data.suppliers) {
      expect(isValidCnpj(supplier.document)).toBe(true);
      expect(supplier.phone).toHaveLength(10);
      expect(normalizePhone(supplier.phone)).toEqual({ ok: true, value: supplier.phone });
      expect(supplier.email).toMatch(/^contato@[a-z0-9.]+\.exemplo\.test$/);
    }
  });

  it("é determinístico com a mesma semente", () => {
    expect(buildTestData(MAX, createSeededRandom(2026))).toEqual(data);
    expect(buildTestData(MAX, createSeededRandom(2027))).not.toEqual(data);
  });

  it("gera só o que foi pedido", () => {
    const onlyCustomers = buildTestData(
      { categories: 0, products: 0, customers: 2, suppliers: 0 },
      createSeededRandom(1),
    );
    expect(onlyCustomers.categories).toEqual([]);
    expect(onlyCustomers.products).toEqual([]);
    expect(onlyCustomers.suppliers).toEqual([]);
    expect(onlyCustomers.customers).toHaveLength(2);
  });

  it("produz conjuntos válidos com várias sementes", () => {
    for (let seed = 0; seed < 50; seed++) {
      const set = buildTestData(MAX, createSeededRandom(seed));
      expect(new Set(set.products.map((p) => p.sku)).size).toBe(MAX.products);
      expect(set.customers.every((c) => isValidCpf(c.document))).toBe(true);
      expect(set.suppliers.every((s) => isValidCnpj(s.document))).toBe(true);
    }
  });
});
