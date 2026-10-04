import type { Unit } from "@prisma/client";

// Gerador de dados de teste da seção "Dados de teste" em Configurações (issue #57). Módulo puro,
// sem banco: monta categorias, fornecedores, clientes e produtos sintéticos que respeitam as mesmas
// regras das actions de cadastro. O serviço do servidor (src/lib/test-data.ts) resolve as colisões
// com o que já existe no banco usando os geradores individuais exportados aqui.
//
// Valores decimais saem como texto (centavos e milésimos calculados em inteiros), para não perder
// precisão até o Prisma.Decimal.

/** Tetos por geração, conferidos no servidor e exibidos na tela. */
export const TEST_DATA_LIMITS = {
  categories: 15,
  products: 50,
  customers: 10,
  suppliers: 5,
} as const;

export type TestDataEntity = keyof typeof TEST_DATA_LIMITS;
export type TestDataCounts = Record<TestDataEntity, number>;

export const TEST_DATA_ENTITIES = Object.keys(TEST_DATA_LIMITS) as TestDataEntity[];

/** Sugestão inicial da tela: os próprios tetos. */
export const DEFAULT_TEST_DATA_COUNTS: TestDataCounts = { ...TEST_DATA_LIMITS };

/** Número aleatório em [0, 1). Injetável para testes determinísticos. */
export type Random = () => number;

const ENTITY_LABELS: Record<TestDataEntity, string> = {
  categories: "categorias",
  products: "produtos",
  customers: "clientes",
  suppliers: "fornecedores",
};

export type CountsValidation = { ok: true; counts: TestDataCounts } | { ok: false; error: string };

/** Valida as quantidades enviadas pelo navegador (valor desconhecido). */
export function validateTestDataCounts(input: unknown): CountsValidation {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Informe as quantidades a gerar." };
  }
  const counts = {} as TestDataCounts;
  for (const entity of TEST_DATA_ENTITIES) {
    const value = (input as Record<string, unknown>)[entity];
    const max = TEST_DATA_LIMITS[entity];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
      return {
        ok: false,
        error: `A quantidade de ${ENTITY_LABELS[entity]} deve ser um número inteiro de 0 a ${max}.`,
      };
    }
    counts[entity] = value;
  }
  if (TEST_DATA_ENTITIES.every((entity) => counts[entity] === 0)) {
    return { ok: false, error: "Informe ao menos uma quantidade maior que zero." };
  }
  // Todo produto gerado recebe uma categoria e uma entrada de estoque com fornecedor do lote
  if (counts.products > 0 && (counts.categories === 0 || counts.suppliers === 0)) {
    return {
      ok: false,
      error: "Para gerar produtos, gere também ao menos uma categoria e um fornecedor.",
    };
  }
  return { ok: true, counts };
}

/** Gerador pseudoaleatório com semente (mulberry32), para testes e reprodução. */
export function createSeededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inteiro em [min, max]. */
function randomInt(random: Random, min: number, max: number) {
  return min + Math.floor(random() * (max - min + 1));
}

function pick<T>(random: Random, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

function randomDigits(random: Random, length: number) {
  let digits = "";
  for (let i = 0; i < length; i++) digits += String(randomInt(random, 0, 9));
  return digits;
}

// Documentos e códigos

function cpfDigit(base: string) {
  let sum = 0;
  for (let i = 0; i < base.length; i++) sum += Number(base[i]) * (base.length + 1 - i);
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

/** CPF válido, só dígitos. */
export function randomCpf(random: Random): string {
  let base = randomDigits(random, 9);
  while (/^(\d)\1+$/.test(base)) base = randomDigits(random, 9);
  const first = cpfDigit(base);
  return `${base}${first}${cpfDigit(`${base}${first}`)}`;
}

function cnpjDigit(base: string) {
  let sum = 0;
  let weight = base.length - 7;
  for (let i = 0; i < base.length; i++) {
    sum += Number(base[i]) * weight;
    weight = weight === 2 ? 9 : weight - 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** CNPJ numérico válido de matriz (filial 0001), só dígitos. */
export function randomCnpj(random: Random): string {
  let root = randomDigits(random, 8);
  while (/^(\d)\1+$/.test(root)) root = randomDigits(random, 8);
  const base = `${root}0001`;
  const first = cnpjDigit(base);
  return `${base}${first}${cnpjDigit(`${base}${first}`)}`;
}

/** Dígito verificador do EAN-13 a partir dos 12 primeiros dígitos. */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** EAN-13 com prefixo 2 (faixa de uso interno da loja), para não colidir com códigos reais. */
export function randomEan13(random: Random): string {
  const first12 = `2${randomDigits(random, 11)}`;
  return `${first12}${ean13CheckDigit(first12)}`;
}

const SKU_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** SKU dos produtos gerados: prefixo TST- e seis caracteres. */
export function randomSku(random: Random): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += pick(random, SKU_ALPHABET.split(""));
  return `TST-${code}`;
}

/** Nome livre entre os já usados: acrescenta " 2", " 3"... em caso de colisão exata. */
export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base} ${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Repete o gerador até obter um valor fora de `taken` (o valor é acrescentado a `taken`). */
export function uniqueValue(generate: () => string, taken: Set<string>, attempts = 1000): string {
  for (let i = 0; i < attempts; i++) {
    const value = generate();
    if (!taken.has(value)) {
      taken.add(value);
      return value;
    }
  }
  throw new Error("Não foi possível gerar um valor único.");
}

// Vocabulário

interface ProductTemplate {
  name: string;
  unit: Unit;
  /** Faixa do preço de custo em centavos. */
  cost: [number, number];
}

interface CategoryTemplate {
  name: string;
  products: ProductTemplate[];
}

const CATEGORY_TEMPLATES: CategoryTemplate[] = [
  {
    name: "Mercearia",
    products: [
      { name: "Arroz Branco 5kg", unit: "UN", cost: [1800, 2800] },
      { name: "Feijão Carioca", unit: "KG", cost: [550, 900] },
      { name: "Açúcar Cristal", unit: "KG", cost: [350, 600] },
      { name: "Óleo de Soja 900ml", unit: "UN", cost: [550, 850] },
    ],
  },
  {
    name: "Bebidas",
    products: [
      { name: "Refrigerante 2L", unit: "UN", cost: [550, 900] },
      { name: "Água Mineral 500ml", unit: "CX", cost: [1200, 2000] },
      { name: "Suco Integral 1L", unit: "UN", cost: [700, 1200] },
    ],
  },
  {
    name: "Hortifrúti",
    products: [
      { name: "Tomate", unit: "KG", cost: [400, 800] },
      { name: "Banana Prata", unit: "KG", cost: [350, 650] },
      { name: "Batata Inglesa", unit: "KG", cost: [300, 600] },
    ],
  },
  {
    name: "Laticínios",
    products: [
      { name: "Leite Integral 1L", unit: "CX", cost: [3800, 5200] },
      { name: "Queijo Muçarela", unit: "KG", cost: [2800, 4200] },
      { name: "Iogurte Natural 170g", unit: "UN", cost: [200, 400] },
    ],
  },
  {
    name: "Padaria",
    products: [
      { name: "Pão Francês", unit: "KG", cost: [900, 1400] },
      { name: "Bolo Caseiro", unit: "UN", cost: [1200, 2200] },
    ],
  },
  {
    name: "Limpeza",
    products: [
      { name: "Detergente 500ml", unit: "UN", cost: [180, 350] },
      { name: "Água Sanitária", unit: "LT", cost: [250, 500] },
      { name: "Sabão em Pó 1kg", unit: "UN", cost: [900, 1600] },
    ],
  },
  {
    name: "Higiene Pessoal",
    products: [
      { name: "Sabonete 90g", unit: "UN", cost: [150, 350] },
      { name: "Creme Dental 90g", unit: "UN", cost: [300, 600] },
      { name: "Papel Higiênico 12 rolos", unit: "UN", cost: [1400, 2400] },
    ],
  },
  {
    name: "Pet Shop",
    products: [
      { name: "Areia Higiênica 4kg", unit: "UN", cost: [1100, 1900] },
      { name: "Coleira Ajustável", unit: "UN", cost: [900, 2200] },
    ],
  },
  {
    name: "Ração Animal",
    products: [
      { name: "Ração para Cães Adultos", unit: "KG", cost: [700, 1500] },
      { name: "Ração para Gatos", unit: "KG", cost: [1100, 2000] },
      { name: "Milho para Aves", unit: "KG", cost: [150, 300] },
    ],
  },
  {
    name: "Sementes e Mudas",
    products: [
      { name: "Semente de Milho Híbrido", unit: "KG", cost: [3000, 6000] },
      { name: "Muda de Alface", unit: "UN", cost: [50, 150] },
    ],
  },
  {
    name: "Ferramentas",
    products: [
      { name: "Enxada com Cabo", unit: "UN", cost: [3500, 6000] },
      { name: "Martelo de Unha", unit: "UN", cost: [2000, 3800] },
    ],
  },
  {
    name: "Material Elétrico",
    products: [
      { name: "Fio Flexível 2,5mm", unit: "M", cost: [180, 350] },
      { name: "Lâmpada LED 9W", unit: "UN", cost: [600, 1200] },
      { name: "Tomada Dupla", unit: "UN", cost: [900, 1800] },
    ],
  },
  {
    name: "Utilidades Domésticas",
    products: [
      { name: "Pano de Prato", unit: "UN", cost: [300, 700] },
      { name: "Mangueira de Jardim", unit: "M", cost: [250, 500] },
    ],
  },
  {
    name: "Papelaria",
    products: [
      { name: "Caderno 96 folhas", unit: "UN", cost: [600, 1200] },
      { name: "Caneta Esferográfica", unit: "CX", cost: [2000, 3500] },
    ],
  },
  {
    name: "Congelados",
    products: [
      { name: "Pão de Queijo Congelado", unit: "KG", cost: [1500, 2500] },
      { name: "Polpa de Fruta", unit: "UN", cost: [250, 500] },
    ],
  },
];

const FIRST_NAMES = [
  "Ana",
  "Bruno",
  "Carla",
  "Diego",
  "Elisa",
  "Fábio",
  "Gabriela",
  "Hugo",
  "Isabela",
  "João",
  "Larissa",
  "Marcos",
  "Natália",
  "Otávio",
  "Paula",
  "Rafael",
  "Sabrina",
  "Tiago",
  "Vanessa",
];
const SURNAMES = [
  "Almeida",
  "Barbosa",
  "Cardoso",
  "Dias",
  "Ferreira",
  "Gomes",
  "Lima",
  "Martins",
  "Nunes",
  "Oliveira",
  "Pereira",
  "Ribeiro",
  "Santos",
  "Teixeira",
  "Vieira",
];
const SUPPLIER_PREFIXES = ["Distribuidora", "Comercial", "Atacadista", "Indústria", "Agro"];
const SUPPLIER_NAMES = [
  "Horizonte",
  "Vale Verde",
  "Boa Safra",
  "Central",
  "Planalto",
  "Sol Nascente",
  "Primavera",
  "Serra Azul",
  "Bom Preço",
  "Litoral",
];
const STREETS = [
  "Rua das Flores",
  "Avenida Brasil",
  "Rua São João",
  "Rua XV de Novembro",
  "Avenida Central",
  "Rua do Comércio",
  "Rua Sete de Setembro",
];
const NEIGHBORHOODS = ["Centro", "Jardim América", "Vila Nova", "São José", "Industrial"];
const AREA_CODES = ["11", "19", "21", "31", "41", "48", "51", "61", "62", "71", "81", "85"];

function slug(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");
}

function randomAddress(random: Random) {
  return `${pick(random, STREETS)}, ${randomInt(random, 10, 2500)} - ${pick(random, NEIGHBORHOODS)}`;
}

/** Celular (11 dígitos) ou fixo (10 dígitos), com DDD, só dígitos. */
function randomPhone(random: Random, mobile: boolean) {
  const areaCode = pick(random, AREA_CODES);
  return mobile
    ? `${areaCode}9${randomDigits(random, 8)}`
    : `${areaCode}${randomInt(random, 2, 5)}${randomDigits(random, 7)}`;
}

/** Centavos inteiros → texto com 2 casas. */
function centsToText(cents: number) {
  return (cents / 100).toFixed(2);
}

/** Milésimos inteiros → texto com 3 casas. */
function thousandthsToText(value: number) {
  return (value / 1000).toFixed(3);
}

const isWholeUnit = (unit: Unit) => unit === "UN" || unit === "CX";

// Conjunto gerado

export interface GeneratedCategory {
  name: string;
}

export interface GeneratedPerson {
  name: string;
  document: string;
  phone: string;
  email: string;
  address: string;
}

export interface GeneratedProduct {
  name: string;
  sku: string;
  barcode: string;
  unit: Unit;
  costPrice: string;
  salePrice: string;
  minStock: string;
  /** Estoque inicial, sempre maior que zero (vira a movimentação IN do lote). */
  initialStock: string;
  /** Índice em `categories` do mesmo conjunto. */
  categoryIndex: number;
  /** Índice em `suppliers` do mesmo conjunto (fornecedor da entrada inicial). */
  supplierIndex: number;
}

export interface TestDataSet {
  categories: GeneratedCategory[];
  suppliers: GeneratedPerson[];
  customers: GeneratedPerson[];
  products: GeneratedProduct[];
}

function buildProduct(
  random: Random,
  template: ProductTemplate,
  name: string,
  categoryIndex: number,
  supplierCount: number,
  skus: Set<string>,
  barcodes: Set<string>,
): GeneratedProduct {
  const costCents = randomInt(random, template.cost[0], template.cost[1]);
  // Margem de 20% a 80%, arredondada ao centavo: venda sempre acima do custo
  const marginPercent = randomInt(random, 20, 80);
  const saleCents = Math.round((costCents * (100 + marginPercent)) / 100);

  const whole = isWholeUnit(template.unit);
  const initialStock = whole
    ? thousandthsToText(randomInt(random, 5, 120) * 1000)
    : thousandthsToText(randomInt(random, 1000, 80000));
  const minStock = whole
    ? thousandthsToText(randomInt(random, 1, 10) * 1000)
    : thousandthsToText(randomInt(random, 0, 5000));

  return {
    name,
    sku: uniqueValue(() => randomSku(random), skus),
    barcode: uniqueValue(() => randomEan13(random), barcodes),
    unit: template.unit,
    costPrice: centsToText(costCents),
    salePrice: centsToText(saleCents),
    minStock,
    initialStock,
    categoryIndex,
    supplierIndex: randomInt(random, 0, supplierCount - 1),
  };
}

/**
 * Monta o conjunto de dados sintéticos. As quantidades já devem ter passado por
 * `validateTestDataCounts`. Nomes, SKU, códigos de barras e documentos são únicos dentro do
 * conjunto; a unicidade contra o banco é resolvida pelo servidor.
 */
export function buildTestData(counts: TestDataCounts, random: Random = Math.random): TestDataSet {
  const categories = CATEGORY_TEMPLATES.slice(0, counts.categories).map((template) => ({
    name: template.name,
  }));

  const supplierNames = new Set<string>();
  const cnpjs = new Set<string>();
  const suppliers: GeneratedPerson[] = Array.from({ length: counts.suppliers }, () => {
    const name = uniqueName(
      `${pick(random, SUPPLIER_PREFIXES)} ${pick(random, SUPPLIER_NAMES)} Ltda`,
      supplierNames,
    );
    supplierNames.add(name);
    return {
      name,
      document: uniqueValue(() => randomCnpj(random), cnpjs),
      phone: randomPhone(random, false),
      email: `contato@${slug(name.replace(/ Ltda$/, ""))}.exemplo.test`,
      address: randomAddress(random),
    };
  });

  const customerNames = new Set<string>();
  const cpfs = new Set<string>();
  const customers: GeneratedPerson[] = Array.from({ length: counts.customers }, () => {
    const name = uniqueName(
      `${pick(random, FIRST_NAMES)} ${pick(random, SURNAMES)} ${pick(random, SURNAMES)}`,
      customerNames,
    );
    customerNames.add(name);
    return {
      name,
      document: uniqueValue(() => randomCpf(random), cpfs),
      phone: randomPhone(random, true),
      email: `${slug(name)}@exemplo.test`,
      address: randomAddress(random),
    };
  });

  // Produtos distribuídos entre as categorias geradas, em rodízio
  const productNames = new Set<string>();
  const skus = new Set<string>();
  const barcodes = new Set<string>();
  const products: GeneratedProduct[] = Array.from({ length: counts.products }, (_, index) => {
    const categoryIndex = index % categories.length;
    const template = pick(random, CATEGORY_TEMPLATES[categoryIndex].products);
    const name = uniqueName(template.name, productNames);
    productNames.add(name);
    return buildProduct(random, template, name, categoryIndex, suppliers.length, skus, barcodes);
  });

  return { categories, suppliers, customers, products };
}
