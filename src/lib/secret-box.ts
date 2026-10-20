import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Cifra textos com AES-256-GCM, só no servidor. A chave é derivada do AUTH_SECRET com um rótulo
// por uso (`info`), então um token de um uso não abre em outro. O GCM recusa token adulterado.
// Formato: [versão (1 byte)][IV (12)][tag (16)][texto cifrado], em base64url.
// Trocar o AUTH_SECRET torna ilegível tudo o que foi cifrado antes.

const IV_BYTES = 12;
const TAG_BYTES = 16;

const keys = new Map<string, { secret: string; key: Buffer }>();

function deriveKey(info: string): Buffer {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET ausente: não é possível cifrar dados no servidor.");
  const cached = keys.get(info);
  if (cached?.secret === secret) return cached.key;
  const key = Buffer.from(hkdfSync("sha256", secret, "gestao-lojas", info, 32));
  keys.set(info, { secret, key });
  return key;
}

export interface SecretBoxOptions {
  // Rótulo HKDF do uso (ex.: "catalog-order-link-v2")
  info: string;
  // Primeiro byte do token, para trocar o formato no futuro
  version: number;
}

export function sealText(plain: string, { info, version }: SecretBoxOptions): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(info), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([version]), iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}

/** Texto decifrado; null se o token for de outra versão, outra chave, adulterado ou corrompido. */
export function openText(token: string, { info, version }: SecretBoxOptions): string | null {
  const data = Buffer.from(token, "base64url");
  if (data.length <= 1 + IV_BYTES + TAG_BYTES || data[0] !== version) return null;
  const iv = data.subarray(1, 1 + IV_BYTES);
  const tag = data.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  // Sem AUTH_SECRET é erro de configuração (lança), não token inválido
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(info), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([
      decipher.update(data.subarray(1 + IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
