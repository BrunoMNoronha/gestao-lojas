-- Índices aditivos de consultas; sem alterações de dados ou regras de negócio.
CREATE INDEX "Sale_cashRegisterId_idx" ON "Sale" ("cashRegisterId");
CREATE INDEX "Sale_customerId_idx" ON "Sale" ("customerId");
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem" ("saleId");
CREATE INDEX "SaleItem_productId_idx" ON "SaleItem" ("productId");
CREATE INDEX "CashMovement_cashRegisterId_idx" ON "CashMovement" ("cashRegisterId");
CREATE INDEX "ReceivablePayment_receivableId_idx" ON "ReceivablePayment" ("receivableId");
CREATE INDEX "ReceivablePayment_cashRegisterId_idx" ON "ReceivablePayment" ("cashRegisterId");
CREATE INDEX "StockMovement_createdAt_id_idx" ON "StockMovement" ("createdAt" DESC, "id" DESC);
CREATE INDEX "Receivable_status_createdAt_idx" ON "Receivable" ("status", "createdAt");
