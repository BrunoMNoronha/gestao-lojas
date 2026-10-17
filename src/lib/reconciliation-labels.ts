// Nomes das pendências de conciliação de vendas offline (#38), usados na Sincronização e no
// detalhe da venda
export const RECONCILIATION_ISSUE_LABELS: Record<string, string> = {
  NEGATIVE_STOCK: "Estoque negativo",
  POST_CLOSING_SALE: "Venda depois do fechamento",
  PRICE_DIVERGENCE: "Preço diferente do atual",
  DATE_ADJUSTED: "Data ajustada",
  DELETED_CUSTOMER: "Cliente excluído",
};
