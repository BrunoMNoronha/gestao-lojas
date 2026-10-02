export type PaymentMethodValue = "MONEY" | "PIX" | "CREDIT_CARD" | "DEBIT_CARD" | "ON_ACCOUNT";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodValue, string> = {
  MONEY: "Dinheiro",
  PIX: "PIX",
  CREDIT_CARD: "Crédito",
  DEBIT_CARD: "Débito",
  ON_ACCOUNT: "Fiado",
};

// Formas aceitas para quitar um título do fiado
export const RECEIVABLE_PAYMENT_METHODS: PaymentMethodValue[] = [
  "MONEY",
  "PIX",
  "CREDIT_CARD",
  "DEBIT_CARD",
];

export const RECEIVABLE_STATUS_LABELS: Record<string, string> = {
  OPEN: "Em aberto",
  PARTIAL: "Parcial",
  PAID: "Quitado",
};
