import { z } from "zod";
import { MAX_ITEMS_PER_LIST } from "@/lib/insights/constants";

// Formato do relatório de insights (issue #113). O schema vai para a API como saída estruturada
// (output_config.format) e valida a resposta antes de gravar; os tipos servem à tela.

const item = z.object({
  titulo: z.string().describe("Título curto do item"),
  explicacao: z.string().describe("Explicação em 1 a 3 frases"),
  indicador: z.string().describe("Número dos dados que sustenta o item, já formatado"),
});

export const InsightReportSchema = z.object({
  resumo: z.string().describe("2 a 4 frases sobre o período comparado ao anterior"),
  destaques: z.array(item),
  alertas: z.array(item.extend({ gravidade: z.enum(["alta", "media", "baixa"]) })),
  oportunidades: z.array(item),
  acoesSugeridas: z.array(item),
});

export type InsightReport = z.infer<typeof InsightReportSchema>;
export type InsightItem = InsightReport["destaques"][number];
export type InsightAlert = InsightReport["alertas"][number];

export interface InsightAnswer {
  resposta: string;
}

export function trimReport(report: InsightReport): InsightReport {
  const cut = <T>(list: T[]) => list.slice(0, MAX_ITEMS_PER_LIST);
  return {
    resumo: report.resumo,
    destaques: cut(report.destaques),
    alertas: cut(report.alertas),
    oportunidades: cut(report.oportunidades),
    acoesSugeridas: cut(report.acoesSugeridas),
  };
}
