-- Parametrização da venda no Fiado (issue #29). Os padrões preservam o comportamento anterior:
-- fiado permitido, sem prazo de vencimento, sem limite de crédito e sem bloqueio por atraso.
ALTER TABLE "StoreSettings" ADD COLUMN     "onAccountBlockOverdue" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onAccountCreditLimit" DECIMAL(10,2),
ADD COLUMN     "onAccountDueDays" INTEGER,
ADD COLUMN     "onAccountEnabled" BOOLEAN NOT NULL DEFAULT true;
