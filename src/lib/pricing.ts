// Precificação compartilhada entre o servidor e o cadastro de produto (sem Prisma: roda no client)

// Margem de lucro padrão aceita nas configurações da loja, em % sobre o custo
export const MAX_PROFIT_MARGIN = 1000;

// Preço de venda sugerido: custo + margem sobre o custo, arredondado ao centavo
export function suggestSalePrice(cost: number, marginPercent: number): number {
  return Math.round(cost * (1 + marginPercent / 100) * 100) / 100;
}
