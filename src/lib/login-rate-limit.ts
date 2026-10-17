import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Limite de tentativas do login com e-mail e senha (src/auth.ts), depois do reCAPTCHA e antes de
// conferir a senha. Módulo comum (sem "use server"): não é exposto como Server Action.
//
// - Recusa com 5 falhas do e-mail ou 20 falhas do IP nos últimos 15 minutos. O limite vale também
//   para e-mails que não existem, e a recusa acontece antes de buscar o usuário: a resposta não
//   revela se o e-mail existe.
// - Cada tentativa é gravada como falha antes da conferência da senha, sob uma trava consultiva por
//   e-mail e outra por IP (mesmo modelo da confirmação da restauração em src/lib/test-data.ts):
//   pedidos em paralelo contam um a um e não passam do limite. Login certo vira sucesso depois.
// - Login certo zera só o contador do e-mail (contam as falhas posteriores ao último sucesso); o
//   do IP continua, para quem tem uma conta não conseguir testar senhas de outras.
// - Tentativas recusadas pelo limite não são gravadas: a espera termina 15 minutos depois da
//   última falha que chegou a conferir a senha.
// - Banco fora do ar ao contar: o login é recusado (fail closed), com log `[login-limit]`. Sem o
//   banco a senha também não seria conferida, então isso não tira acesso de ninguém.
// - Registros com mais de 24 h são apagados a cada tentativa (índice em createdAt).

export const MAX_LOGIN_FAILURES_PER_EMAIL = 5;
export const MAX_LOGIN_FAILURES_PER_IP = 20;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;

// Travas consultivas por e-mail e por IP (números fixos, como os de src/lib/test-data.ts). A trava
// do e-mail é sempre pega antes da do IP, então duas tentativas nunca esperam uma pela outra.
const LOCK_KEYS = { email: 57101, ip: 57102 } as const;
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 };

// Limites de tamanho do que vai para o banco: e-mail (RFC 5321) e IP (IPv6 com zona)
const MAX_EMAIL_LENGTH = 320;
const MAX_IP_LENGTH = 64;

export type LockScope = keyof typeof LOCK_KEYS;

/** Operações usadas dentro da transação da reserva. */
export interface LoginAttemptTx {
  /** Trava até o fim da transação (pg_advisory_xact_lock). */
  lock(scope: LockScope, key: string): Promise<void>;
  countFailures(filter: { email: string } | { ip: string }, since: Date): Promise<number>;
  lastSuccessAt(email: string, since: Date): Promise<Date | null>;
  createFailure(data: { email: string; ip: string | null; createdAt: Date }): Promise<string>;
}

export interface LoginAttemptStore {
  transaction<T>(fn: (tx: LoginAttemptTx) => Promise<T>): Promise<T>;
  markSuccess(id: string): Promise<void>;
  deleteOlderThan(date: Date): Promise<void>;
}

function prismaTx(tx: Prisma.TransactionClient): LoginAttemptTx {
  return {
    async lock(scope, key) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEYS[scope]}::int, hashtext(${key}))`;
    },
    countFailures: (filter, since) =>
      tx.loginAttempt.count({ where: { ...filter, success: false, createdAt: { gte: since } } }),
    async lastSuccessAt(email, since) {
      const last = await tx.loginAttempt.findFirst({
        where: { email, success: true, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      return last?.createdAt ?? null;
    },
    async createFailure(data) {
      const created = await tx.loginAttempt.create({
        data: { ...data, success: false },
        select: { id: true },
      });
      return created.id;
    },
  };
}

export const prismaLoginAttemptStore: LoginAttemptStore = {
  transaction: (fn) => prisma.$transaction((tx) => fn(prismaTx(tx)), TRANSACTION_OPTIONS),
  async markSuccess(id) {
    await prisma.loginAttempt.update({ where: { id }, data: { success: true } });
  },
  async deleteOlderThan(date) {
    await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: date } } });
  },
};

/**
 * IP do cliente. Na Vercel, `x-forwarded-for` e `x-real-ip` são preenchidos pela própria
 * plataforma (o valor enviado pelo cliente é substituído). Fora dela podem faltar: sem IP, vale só
 * o limite por e-mail, para um proxy sem esses cabeçalhos não juntar todo mundo num IP só.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip")?.trim();
  return ip ? ip.slice(0, MAX_IP_LENGTH) : null;
}

export function normalizeLoginEmail(email: string): string {
  return email.toLowerCase().trim().slice(0, MAX_EMAIL_LENGTH);
}

export type GuardedLogin<T> =
  | { status: "done"; user: T | null }
  | { status: "limited" }
  // Banco indisponível ao contar: o login é recusado (fail closed)
  | { status: "unavailable" };

/** Grava a tentativa como falha, ou devolve null quando o e-mail ou o IP já está no limite. */
async function reserveAttempt(
  store: LoginAttemptStore,
  email: string,
  ip: string | null,
  now: Date,
): Promise<string | null> {
  return store.transaction(async (tx) => {
    await tx.lock("email", email);
    if (ip) await tx.lock("ip", ip);

    const windowStart = new Date(now.getTime() - LOGIN_FAILURE_WINDOW_MS);
    const emailSince = (await tx.lastSuccessAt(email, windowStart)) ?? windowStart;
    if ((await tx.countFailures({ email }, emailSince)) >= MAX_LOGIN_FAILURES_PER_EMAIL) {
      return null;
    }
    if (ip && (await tx.countFailures({ ip }, windowStart)) >= MAX_LOGIN_FAILURES_PER_IP) {
      return null;
    }
    return tx.createFailure({ email, ip, createdAt: now });
  });
}

/**
 * Roda `verify` (busca do usuário e conferência da senha) só se o e-mail e o IP estiverem abaixo
 * do limite. `verify` devolve o usuário ou null; qualquer null (e-mail inexistente, senha errada,
 * usuário inativo) ou erro conta como falha.
 */
export async function guardLoginAttempt<T>(
  { email, ip }: { email: string; ip: string | null },
  verify: () => Promise<T | null>,
  {
    store = prismaLoginAttemptStore,
    now = new Date(),
  }: { store?: LoginAttemptStore; now?: Date } = {},
): Promise<GuardedLogin<T>> {
  const key = normalizeLoginEmail(email);

  let attemptId: string | null;
  try {
    attemptId = await reserveAttempt(store, key, ip, now);
  } catch (error) {
    console.error("[login-limit] Falha ao contar as tentativas; login recusado:", error);
    return { status: "unavailable" };
  }
  if (!attemptId) return { status: "limited" };

  const user = await verify();

  const followUps: Promise<void>[] = [
    store.deleteOlderThan(new Date(now.getTime() - LOGIN_ATTEMPT_RETENTION_MS)),
  ];
  if (user) followUps.push(store.markSuccess(attemptId));
  // Falha aqui não muda o resultado: o pior caso é um login certo seguir contado como falha
  for (const result of await Promise.allSettled(followUps)) {
    if (result.status === "rejected") {
      console.error("[login-limit] Falha ao atualizar as tentativas:", result.reason);
    }
  }

  return { status: "done", user };
}
