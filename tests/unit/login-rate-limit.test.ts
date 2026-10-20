import { describe, it, expect, vi, afterEach } from "vitest";
import {
  clientIp,
  guardLoginAttempt,
  LOGIN_ATTEMPT_RETENTION_MS,
  LOGIN_FAILURE_WINDOW_MS,
  MAX_LOGIN_FAILURES_PER_EMAIL,
  MAX_LOGIN_FAILURES_PER_IP,
  type LoginAttemptStore,
  type LoginAttemptTx,
} from "@/lib/login-rate-limit";

interface Row {
  id: string;
  email: string;
  ip: string | null;
  success: boolean;
  createdAt: Date;
}

// Cede a vez a outras promessas, como uma ida ao banco: sem as travas, tentativas em paralelo
// leriam a mesma contagem antes de qualquer uma gravar.
const yieldToOthers = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Tabela LoginAttempt em memória, com travas que só soltam no fim da transação (como no Postgres). */
class MemoryStore implements LoginAttemptStore {
  rows: Row[] = [];
  private lockTails = new Map<string, Promise<void>>();
  private nextId = 1;

  async transaction<T>(fn: (tx: LoginAttemptTx) => Promise<T>): Promise<T> {
    const releases: (() => void)[] = [];
    const tx: LoginAttemptTx = {
      lock: async (scope, key) => {
        const name = `${scope}:${key}`;
        const previous = this.lockTails.get(name) ?? Promise.resolve();
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        this.lockTails.set(
          name,
          previous.then(() => held),
        );
        releases.push(release);
        await previous;
      },
      countFailures: async (filter, since) => {
        await yieldToOthers();
        return this.rows.filter(
          (r) =>
            !r.success &&
            r.createdAt >= since &&
            ("email" in filter ? r.email === filter.email : r.ip === filter.ip),
        ).length;
      },
      lastSuccessAt: async (email, since) => {
        await yieldToOthers();
        const times = this.rows
          .filter((r) => r.success && r.email === email && r.createdAt >= since)
          .map((r) => r.createdAt.getTime());
        return times.length ? new Date(Math.max(...times)) : null;
      },
      createFailure: async (data) => {
        await yieldToOthers();
        const id = String(this.nextId++);
        this.rows.push({ id, ...data, success: false });
        return id;
      },
    };
    try {
      return await fn(tx);
    } finally {
      releases.forEach((release) => release());
    }
  }

  async markSuccess(id: string) {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.success = true;
  }

  async deleteOlderThan(date: Date) {
    this.rows = this.rows.filter((r) => r.createdAt >= date);
  }
}

const T0 = new Date("2026-10-17T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const USER = { id: "u1", email: "dona@loja.com" };

// Base de usuários de mentira: só "dona@loja.com" com a senha "certa" existe
interface AttemptOptions {
  email?: string;
  password?: string;
  ip?: string | null;
  now?: Date;
}

function attempt(
  store: MemoryStore,
  { email = USER.email, password = "errada", ip = "200.1.1.1", now = T0 }: AttemptOptions = {},
) {
  const verify = vi.fn(async () =>
    email.toLowerCase() === USER.email && password === "certa" ? USER : null,
  );
  return guardLoginAttempt({ email, ip }, verify, { store, now }).then((result) => ({
    result,
    verify,
  }));
}

async function failTimes(store: MemoryStore, times: number, options: AttemptOptions = {}) {
  for (let i = 0; i < times; i++) {
    const { result } = await attempt(store, options);
    expect(result).toEqual({ status: "done", user: null });
  }
}

afterEach(() => vi.restoreAllMocks());

describe("limite de tentativas de login", () => {
  it("recusa o e-mail depois de 5 falhas sem conferir a senha, mesmo a certa", async () => {
    const store = new MemoryStore();
    await failTimes(store, MAX_LOGIN_FAILURES_PER_EMAIL);

    const { result, verify } = await attempt(store, { password: "certa" });
    expect(result).toEqual({ status: "limited" });
    expect(verify).not.toHaveBeenCalled();
    // A recusa não é gravada: não prolonga a espera
    expect(store.rows).toHaveLength(MAX_LOGIN_FAILURES_PER_EMAIL);
  });

  it("conta o e-mail sem diferenciar maiúsculas nem espaços, e de qualquer IP", async () => {
    const store = new MemoryStore();
    for (let i = 0; i < MAX_LOGIN_FAILURES_PER_EMAIL; i++) {
      await attempt(store, { email: i % 2 ? " Dona@Loja.com " : USER.email, ip: `10.0.0.${i}` });
    }
    const { result } = await attempt(store, { ip: "10.9.9.9" });
    expect(result).toEqual({ status: "limited" });
  });

  it("conta e-mail inexistente igual e recusa com a mesma resposta", async () => {
    const store = new MemoryStore();
    await failTimes(store, MAX_LOGIN_FAILURES_PER_EMAIL, { email: "ninguem@loja.com" });
    await failTimes(store, MAX_LOGIN_FAILURES_PER_EMAIL, { ip: "200.2.2.2" });

    const missing = await attempt(store, { email: "ninguem@loja.com" });
    const existing = await attempt(store, { ip: "200.2.2.2" });
    expect(missing.result).toEqual({ status: "limited" });
    expect(existing.result).toEqual(missing.result);
    expect(store.rows.filter((r) => r.email === "ninguem@loja.com")).toHaveLength(
      MAX_LOGIN_FAILURES_PER_EMAIL,
    );
  });

  it("recusa o IP depois de 20 falhas, em e-mails diferentes", async () => {
    const store = new MemoryStore();
    for (let i = 0; i < MAX_LOGIN_FAILURES_PER_IP; i++) {
      const { result } = await attempt(store, { email: `teste${i}@loja.com` });
      expect(result.status).toBe("done");
    }

    const { result, verify } = await attempt(store, { password: "certa" });
    expect(result).toEqual({ status: "limited" });
    expect(verify).not.toHaveBeenCalled();
    // Outro IP continua entrando
    expect((await attempt(store, { password: "certa", ip: "200.9.9.9" })).result).toEqual({
      status: "done",
      user: USER,
    });
  });

  it("sem IP conhecido vale só o limite por e-mail", async () => {
    const store = new MemoryStore();
    for (let i = 0; i < MAX_LOGIN_FAILURES_PER_IP + 5; i++) {
      const { result } = await attempt(store, { email: `teste${i}@loja.com`, ip: null });
      expect(result.status).toBe("done");
    }
  });

  it("libera quando a janela de 15 minutos passa", async () => {
    const store = new MemoryStore();
    await failTimes(store, MAX_LOGIN_FAILURES_PER_EMAIL);

    const stillBlocked = await attempt(store, {
      password: "certa",
      now: at(LOGIN_FAILURE_WINDOW_MS),
    });
    expect(stillBlocked.result).toEqual({ status: "limited" });

    const released = await attempt(store, {
      password: "certa",
      now: at(LOGIN_FAILURE_WINDOW_MS + 1),
    });
    expect(released.result).toEqual({ status: "done", user: USER });
  });

  it("a janela é deslizante: conta só as falhas dos últimos 15 minutos", async () => {
    const store = new MemoryStore();
    await failTimes(store, MAX_LOGIN_FAILURES_PER_EMAIL - 1);
    await failTimes(store, 1, { now: at(10 * 60 * 1000) });

    // Aos 15 min + 1 ms, só a falha dos 10 minutos ainda conta
    const { result } = await attempt(store, { now: at(LOGIN_FAILURE_WINDOW_MS + 1) });
    expect(result).toEqual({ status: "done", user: null });
  });

  it("tentativas em paralelo não passam do limite", async () => {
    const store = new MemoryStore();
    const results = await Promise.all(Array.from({ length: 12 }, () => attempt(store)));

    const checked = results.filter(({ verify }) => verify.mock.calls.length > 0);
    expect(checked).toHaveLength(MAX_LOGIN_FAILURES_PER_EMAIL);
    expect(results.filter(({ result }) => result.status === "limited")).toHaveLength(
      12 - MAX_LOGIN_FAILURES_PER_EMAIL,
    );
    expect(store.rows).toHaveLength(MAX_LOGIN_FAILURES_PER_EMAIL);
  });

  it("tentativas em paralelo de e-mails diferentes não passam do limite do IP", async () => {
    const store = new MemoryStore();
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => attempt(store, { email: `teste${i}@loja.com` })),
    );
    expect(results.filter(({ verify }) => verify.mock.calls.length > 0)).toHaveLength(
      MAX_LOGIN_FAILURES_PER_IP,
    );
  });

  it("login certo zera o contador do e-mail, mas não o do IP", async () => {
    const store = new MemoryStore();
    await failTimes(store, MAX_LOGIN_FAILURES_PER_EMAIL - 1);
    const login = await attempt(store, { password: "certa", now: at(1000) });
    expect(login.result.status).toBe("done");

    // E-mail: 4 falhas novas ainda passam
    await failTimes(store, MAX_LOGIN_FAILURES_PER_EMAIL - 1, { now: at(2000) });

    // IP: as falhas de antes do login certo continuam contando
    for (let i = 0; i < MAX_LOGIN_FAILURES_PER_IP - 2 * (MAX_LOGIN_FAILURES_PER_EMAIL - 1); i++) {
      await attempt(store, { email: `outro${i}@loja.com`, now: at(3000) });
    }
    expect((await attempt(store, { email: "mais-um@loja.com", now: at(3000) })).result).toEqual({
      status: "limited",
    });
  });

  it("apaga registros com mais de 24 h", async () => {
    const store = new MemoryStore();
    await failTimes(store, 2);
    await attempt(store, { now: at(LOGIN_ATTEMPT_RETENTION_MS + 1) });
    expect(store.rows).toHaveLength(1);
  });

  it("recusa o login quando o banco falha ao contar (fail closed)", async () => {
    const store = new MemoryStore();
    vi.spyOn(store, "transaction").mockRejectedValue(new Error("conexão recusada"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result, verify } = await attempt(store, { password: "certa" });
    expect(result).toEqual({ status: "unavailable" });
    expect(verify).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[login-limit]"), expect.any(Error));
  });

  it("mantém o login certo se a marcação de sucesso falhar", async () => {
    const store = new MemoryStore();
    vi.spyOn(store, "markSuccess").mockRejectedValue(new Error("timeout"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await attempt(store, { password: "certa" })).result).toEqual({
      status: "done",
      user: USER,
    });
  });
});

describe("IP do cliente", () => {
  it("usa o primeiro endereço do x-forwarded-for", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "200.1.1.1, 10.0.0.1" }))).toBe("200.1.1.1");
  });

  it("cai para x-real-ip e depois para nenhum", () => {
    expect(clientIp(new Headers({ "x-real-ip": " 2804:14c::1 " }))).toBe("2804:14c::1");
    expect(clientIp(new Headers({ "x-forwarded-for": " ", "x-real-ip": "200.1.1.1" }))).toBe(
      "200.1.1.1",
    );
    expect(clientIp(new Headers())).toBeNull();
  });

  it("corta valores longos demais", () => {
    expect(clientIp(new Headers({ "x-real-ip": "a".repeat(500) }))).toHaveLength(64);
  });
});
