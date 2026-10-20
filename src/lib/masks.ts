// Máscaras e validações de CPF, CNPJ, telefone, CEP e dinheiro (issue #28). Sem acesso a banco:
// usado nos formulários (Client Components) e nas Server Actions. Os valores são gravados sem
// pontuação e formatados só na exibição.

export type DocumentKind = "CPF" | "CNPJ";

export const onlyDigits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

/** CNPJ aceita o formato alfanumérico da Receita (12 posições A-Z/0-9 + 2 dígitos verificadores). */
export const onlyAlphanumeric = (value: string | null | undefined) =>
  (value ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

/** Aplica o padrão (# = posição) até onde houver caracteres: formata enquanto o usuário digita. */
function applyPattern(raw: string, pattern: string): string {
  let out = "";
  let i = 0;
  for (const ch of pattern) {
    if (i >= raw.length) break;
    if (ch === "#") out += raw[i++];
    else out += ch;
  }
  return out;
}

export const formatCpf = (value: string | null | undefined) =>
  applyPattern(onlyDigits(value).slice(0, 11), "###.###.###-##");

export const formatCnpj = (value: string | null | undefined) =>
  applyPattern(onlyAlphanumeric(value).slice(0, 14), "##.###.###/####-##");

/** Campo único de CPF ou CNPJ: até 11 dígitos é CPF; com letra ou mais caracteres, CNPJ. */
export function formatCpfOrCnpj(value: string | null | undefined): string {
  const raw = onlyAlphanumeric(value);
  return raw.length > 11 || /[A-Z]/.test(raw) ? formatCnpj(raw) : formatCpf(raw);
}

/** Telefone com DDD: (00) 0000-0000 ou (00) 00000-0000. */
export function formatPhone(value: string | null | undefined): string {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : "";
  if (digits.length <= 10) return applyPattern(digits, "(##) ####-####");
  return applyPattern(digits, "(##) #####-####");
}

export const formatCep = (value: string | null | undefined) =>
  applyPattern(onlyDigits(value).slice(0, 8), "#####-###");

// Exibição de valores já gravados: formata quando o formato é reconhecível; senão mostra como está
// (dados antigos que a migration não conseguiu normalizar).

export function displayDocument(value: string | null | undefined): string {
  const raw = onlyAlphanumeric(value);
  if (/^\d{11}$/.test(raw)) return formatCpf(raw);
  if (/^[0-9A-Z]{12}\d{2}$/.test(raw)) return formatCnpj(raw);
  return value ?? "";
}

/**
 * Documento de cliente mascarado para guardar no aparelho do PDV offline (docs/OFFLINE.md seção
 * 3.8): CPF `***.456.789-**`, CNPJ `**.345.678/0001-**`. Formato não reconhecido vira null, para
 * nunca expor um documento antigo que não foi normalizado.
 */
export function maskDocument(value: string | null | undefined): string | null {
  const raw = onlyAlphanumeric(value);
  if (/^\d{11}$/.test(raw)) return `***${formatCpf(raw).slice(3, 12)}**`;
  if (/^[0-9A-Z]{12}\d{2}$/.test(raw)) return `**${formatCnpj(raw).slice(2, 16)}**`;
  return null;
}

export function displayPhone(value: string | null | undefined): string {
  const digits = onlyDigits(value);
  return digits.length === 10 || digits.length === 11 ? formatPhone(digits) : (value ?? "");
}

export function displayCep(value: string | null | undefined): string {
  const digits = onlyDigits(value);
  return digits.length === 8 ? formatCep(digits) : (value ?? "");
}

/** Busca por documento/telefone aceitando o termo com ou sem máscara. */
export function matchesMaskedValue(value: string | null | undefined, query: string): boolean {
  if (!value) return false;
  const q = query.trim().toLowerCase();
  if (q && value.toLowerCase().includes(q)) return true;
  const raw = onlyAlphanumeric(query);
  return raw.length > 0 && onlyAlphanumeric(value).includes(raw);
}

/** Termos de busca no banco: o texto digitado e, se diferente, a versão sem pontuação. */
export function maskedSearchTerms(query: string): string[] {
  const q = query.trim();
  const raw = onlyAlphanumeric(q);
  return raw && raw !== q.toUpperCase() ? [q, raw] : [q];
}

/**
 * Formas em que um documento pode estar gravado: sem pontuação (padrão) ou formatado (registro
 * antigo que a migration não normalizou). Usado para checar duplicidade.
 */
export const documentLookupValues = (normalized: string) =>
  Array.from(new Set([normalized, displayDocument(normalized)]));

// Validação (dígitos verificadores)

function allSameChar(value: string) {
  return /^(.)\1+$/.test(value);
}

export function isValidCpf(value: string | null | undefined): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || allSameChar(cpf)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

/** CNPJ numérico ou alfanumérico: cada caractere vale (código ASCII − 48), módulo 11. */
export function isValidCnpj(value: string | null | undefined): boolean {
  const cnpj = onlyAlphanumeric(value);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || allSameChar(cnpj)) return false;
  const digit = (len: number) => {
    let sum = 0;
    let weight = len - 7;
    for (let i = 0; i < len; i++) {
      sum += (cnpj.charCodeAt(i) - 48) * weight;
      weight = weight === 2 ? 9 : weight - 1;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return digit(12) === Number(cnpj[12]) && digit(13) === Number(cnpj[13]);
}

type Normalized = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * Normaliza e valida um documento opcional para gravar: vazio vira null; CPF fica só com dígitos e
 * CNPJ só com letras maiúsculas e dígitos. `kind` omitido aceita CPF ou CNPJ.
 */
export function normalizeDocument(
  value: string | null | undefined,
  kind?: DocumentKind,
): Normalized {
  const raw = onlyAlphanumeric(value);
  if (!raw) return { ok: true, value: null };
  const asCpf = /^\d{11}$/.test(raw);
  if ((kind === "CPF" || (!kind && asCpf)) && isValidCpf(raw)) return { ok: true, value: raw };
  if ((kind === "CNPJ" || (!kind && !asCpf)) && isValidCnpj(raw)) return { ok: true, value: raw };
  const label = kind ?? (asCpf ? "CPF" : raw.length <= 11 ? "CPF ou CNPJ" : "CNPJ");
  return { ok: false, error: `${label} inválido. Confira os números digitados.` };
}

export function normalizePhone(value: string | null | undefined): Normalized {
  const digits = onlyDigits(value);
  if (!digits) return { ok: true, value: null };
  if (digits.length === 10 || digits.length === 11) return { ok: true, value: digits };
  return { ok: false, error: "Telefone inválido. Informe DDD e número, ex.: (11) 99999-8888." };
}

export function normalizeCep(value: string | null | undefined): Normalized {
  const digits = onlyDigits(value);
  if (!digits) return { ok: true, value: null };
  if (digits.length === 8) return { ok: true, value: digits };
  return { ok: false, error: "CEP inválido. Informe os 8 dígitos, ex.: 01310-100." };
}

// Dinheiro: o campo é preenchido da direita para a esquerda (centavos primeiro).

/** Até R$ 999.999.999,99. */
const MAX_MONEY_DIGITS = 11;

export function formatMoneyInput(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

/**
 * Lê o texto digitado no campo de dinheiro: os dígitos são os centavos. Sem dígitos → null;
 * acima do limite → undefined (a digitação é ignorada).
 */
export function parseMoneyInput(text: string): number | null | undefined {
  const digits = onlyDigits(text).replace(/^0+(?=\d)/, "");
  if (!digits) return null;
  if (digits.length > MAX_MONEY_DIGITS) return undefined;
  return Number(digits) / 100;
}
