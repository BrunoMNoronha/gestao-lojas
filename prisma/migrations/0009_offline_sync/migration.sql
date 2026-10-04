-- Sincronização das vendas offline e conciliação (issue #38, docs/OFFLINE.md seções 3 a 5).
-- Compatível com os dados existentes: as operações já gravadas (vendas online) ficam APPLIED, e
-- "deviceId" (sempre nulo até aqui) passa a UUID com chave estrangeira, sem recriar a coluna.

-- CreateEnum
CREATE TYPE "SyncOperationStatus" AS ENUM ('APPLIED', 'CONFLICT', 'APPROVED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "SyncConflictReason" AS ENUM ('DEVICE_REVOKED', 'GRANT_MISMATCH', 'CASH_REGISTER_MISMATCH', 'PRICE_NOT_VALID', 'PRODUCT_NOT_FOUND', 'CUSTOMER_NOT_FOUND', 'FRACTIONAL_QUANTITY', 'ON_ACCOUNT_OFFLINE', 'INVALID_AMOUNTS');

-- CreateEnum
CREATE TYPE "ReconciliationIssueType" AS ENUM ('NEGATIVE_STOCK', 'POST_CLOSING_SALE', 'PRICE_DIVERGENCE', 'DATE_ADJUSTED', 'DELETED_CUSTOMER');

-- AlterTable
ALTER TABLE "SyncOperation" ADD COLUMN     "appliedTxid" BIGINT,
ADD COLUMN     "conflictMessage" TEXT,
ADD COLUMN     "conflictReason" "SyncConflictReason",
ADD COLUMN     "grantId" UUID,
ADD COLUMN     "payload" JSONB,
ADD COLUMN     "resolutionNote" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedById" TEXT,
ADD COLUMN     "status" "SyncOperationStatus" NOT NULL DEFAULT 'APPLIED',
ALTER COLUMN "deviceId" SET DATA TYPE UUID USING "deviceId"::uuid;

-- CreateTable
CREATE TABLE "ReconciliationIssue" (
    "id" TEXT NOT NULL,
    "type" "ReconciliationIssueType" NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "ReconciliationIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReconciliationIssue_acknowledgedAt_createdAt_idx" ON "ReconciliationIssue"("acknowledgedAt", "createdAt");

-- CreateIndex
CREATE INDEX "ReconciliationIssue_saleId_idx" ON "ReconciliationIssue"("saleId");

-- CreateIndex
CREATE INDEX "SyncOperation_status_receivedAt_idx" ON "SyncOperation"("status", "receivedAt");

-- AddForeignKey
ALTER TABLE "SyncOperation" ADD CONSTRAINT "SyncOperation_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "OfflineDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncOperation" ADD CONSTRAINT "SyncOperation_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "OfflineGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncOperation" ADD CONSTRAINT "SyncOperation_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationIssue" ADD CONSTRAINT "ReconciliationIssue_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationIssue" ADD CONSTRAINT "ReconciliationIssue_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationIssue" ADD CONSTRAINT "ReconciliationIssue_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
