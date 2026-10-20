// Vendas locais, leitura do snapshot e abertura online compartilham a mesma trava entre abas.
// Sem Web Locks, as vendas existentes continuam disponíveis; a abertura exige outro navegador.
export async function withPdvStockLock<T>(
  userId: string,
  work: () => Promise<T>,
  requireLock = false,
): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(`gestao-lojas-stock:${userId}`, work);
  }
  if (requireLock) {
    throw new Error(
      "Este navegador não permite abrir caixas com segurança no PDV. Use o módulo Estoque, com internet.",
    );
  }
  return work();
}
