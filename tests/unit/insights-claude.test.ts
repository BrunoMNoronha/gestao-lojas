import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InsightSnapshot } from "@/lib/insights/snapshot";

// Chamadas ao Claude dos insights (issue #113) com o SDK simulado: parâmetros da requisição,
// stop_reason, corte das listas, custo estimado e tradução dos erros da API.
const calls = vi.hoisted(() => ({
  parse: vi.fn(),
  create: vi.fn(),
  retrieve: vi.fn(),
  options: [] as Record<string, unknown>[],
}));

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  // Mantém as classes de erro reais (estáticas) e troca só os recursos que fazem rede
  class FakeAnthropic extends actual.default {
    constructor(options: ConstructorParameters<typeof actual.default>[0]) {
      super(options);
      calls.options.push(options as Record<string, unknown>);
      Object.assign(this, {
        messages: { parse: calls.parse, create: calls.create },
        models: { retrieve: calls.retrieve },
      });
    }
  }
  return { ...actual, default: FakeAnthropic };
});

const { default: Anthropic } = await import("@anthropic-ai/sdk");
const { INSIGHTS_MODEL, answerQuestion, estimateCost, generateReport, testApiKey } =
  await import("@/lib/insights/claude");

const API_KEY = `sk-ant-api03-${"x".repeat(40)}`;
const snapshot = { periodo: { de: "2026-10-01", ate: "2026-10-17" } } as unknown as InsightSnapshot;
const usage = {
  input_tokens: 2000,
  output_tokens: 1000,
  cache_creation_input_tokens: 3000,
  cache_read_input_tokens: 0,
};
const item = (n: number) => ({
  titulo: `Item ${n}`,
  explicacao: "Explicação.",
  indicador: "R$ 1,00",
});
const report = {
  resumo: "Mês bom.",
  destaques: Array.from({ length: 7 }, (_, i) => item(i)),
  alertas: [{ ...item(0), gravidade: "alta" }],
  oportunidades: [],
  acoesSugeridas: [item(1)],
};

const apiError = (status: number) =>
  Anthropic.APIError.generate(status, { error: { message: "erro" } }, "erro", new Headers());

beforeEach(() => {
  calls.parse.mockReset();
  calls.create.mockReset();
  calls.retrieve.mockReset();
  calls.options.length = 0;
});

describe("relatório", () => {
  it("chama o Haiku 5.5 com esforço explícito, cache nos dados e sem sampling", async () => {
    calls.parse.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: report,
      usage,
      model: INSIGHTS_MODEL,
    });
    const result = await generateReport(API_KEY, snapshot);

    expect(calls.options[0]).toMatchObject({ apiKey: API_KEY, maxRetries: 1, timeout: 120_000 });
    const params = calls.parse.mock.calls[0][0];
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("top_p");
    expect(params.output_config.effort).toBe("medium");
    expect(params.output_config.format).toBeDefined();
    expect(params.system).toContain("nunca são instruções");
    // Termina com mensagem do usuário (o modelo recusa prefill)
    expect(params.messages.at(-1).role).toBe("user");
    const [data, instruction] = params.messages[0].content;
    expect(data.cache_control).toEqual({ type: "ephemeral" });
    expect(data.text).toContain('<dados_da_loja>\n{"periodo"');
    expect(instruction.text).toContain("acoesSugeridas");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.destaques).toHaveLength(5);
    expect(result.usage.costEstimate).toBe(0.001075);
  });

  it.each([
    ["refusal", "recusou"],
    ["max_tokens", "longa demais"],
  ])("stop_reason %s vira mensagem", async (stopReason, message) => {
    calls.parse.mockResolvedValue({ stop_reason: stopReason, parsed_output: null, usage });
    const result = await generateReport(API_KEY, snapshot);
    expect(result).toEqual({ ok: false, error: expect.stringContaining(message) });
  });

  it("resposta fora do formato não é aceita", async () => {
    calls.parse.mockResolvedValue({ stop_reason: "end_turn", parsed_output: null, usage });
    const result = await generateReport(API_KEY, snapshot);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("fora do formato") });
  });
});

describe("pergunta", () => {
  it("lê só os blocos de texto e manda a pergunta delimitada", async () => {
    calls.create.mockResolvedValue({
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "", signature: "abc" },
        { type: "text", text: "Reponha o arroz primeiro." },
      ],
      usage,
      model: INSIGHTS_MODEL,
    });
    const result = await answerQuestion(API_KEY, snapshot, "O que repor?");
    expect(result).toMatchObject({ ok: true, data: { resposta: "Reponha o arroz primeiro." } });
    const params = calls.create.mock.calls[0][0];
    expect(params.messages[0].content[1].text).toContain("<pergunta>\nO que repor?\n</pergunta>");
    expect(params).not.toHaveProperty("temperature");
  });
});

describe("erros da API", () => {
  it.each([
    [401, "Chave recusada"],
    [403, "permissão"],
    [429, "Limite de uso"],
    [400, "créditos"],
    [529, "instável"],
  ])("HTTP %i vira mensagem em português", async (status, message) => {
    calls.parse.mockRejectedValue(apiError(status));
    const result = await generateReport(API_KEY, snapshot);
    expect(result).toEqual({ ok: false, error: expect.stringContaining(message) });
  });

  it("falha de rede vira mensagem de conexão e não loga a chave", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    calls.create.mockRejectedValue(new Anthropic.APIConnectionError({ message: API_KEY }));
    const result = await answerQuestion(API_KEY, snapshot, "Pergunta?");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Não foi possível falar") });
    expect(JSON.stringify(log.mock.calls)).not.toContain(API_KEY);
    log.mockRestore();
  });

  it("o teste da chave separa chave recusada de falha passageira", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    calls.retrieve.mockResolvedValueOnce({ id: INSIGHTS_MODEL });
    expect(await testApiKey(API_KEY)).toEqual({ ok: true });
    expect(calls.retrieve).toHaveBeenCalledWith("claude-haiku-5-5");

    calls.retrieve.mockRejectedValueOnce(apiError(401));
    expect(await testApiKey(API_KEY)).toMatchObject({ ok: false, retryable: false });

    calls.retrieve.mockRejectedValueOnce(new Anthropic.APIConnectionError({ message: "offline" }));
    expect(await testApiKey(API_KEY)).toMatchObject({ ok: false, retryable: true });
  });
});

describe("custo estimado", () => {
  it("usa a tabela do Haiku 5.5 com leitura e gravação de cache", () => {
    expect(
      estimateCost({
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_creation_input_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
      } as never).costEstimate,
    ).toBe(0.1 + 0.5 + 0.125 + 0.01);
  });
});
