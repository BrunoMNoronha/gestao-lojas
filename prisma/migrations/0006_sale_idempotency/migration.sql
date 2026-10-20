-- Idempotência da venda e data local da venda (issue #35, docs/OFFLINE.md seções 3.6 e 5).
-- Compatível com vendas antigas: occurredAt recebe createdAt, e elas ficam sem SyncOperation.

-- CreateEnum
CREATE TYPE "SyncOperationKind" AS ENUM ('SALE_CREATE');

-- AlterTable: adiciona, preenche com a data de gravação e só então exige o valor
ALTER TABLE "Sale" ADD COLUMN     "occurredAt" TIMESTAMP(3);
UPDATE "Sale" SET "occurredAt" = "createdAt";
ALTER TABLE "Sale" ALTER COLUMN "occurredAt" SET NOT NULL;

-- CreateTable
CREATE TABLE "SyncOperation" (
    "id" UUID NOT NULL,
    "kind" "SyncOperationKind" NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,
    "cashRegisterId" TEXT,
    "saleId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncOperation_saleId_key" ON "SyncOperation"("saleId");

-- CreateIndex
CREATE INDEX "SyncOperation_userId_receivedAt_idx" ON "SyncOperation"("userId", "receivedAt");

-- CreateIndex
CREATE INDEX "Sale_occurredAt_idx" ON "Sale"("occurredAt");

-- AddForeignKey
ALTER TABLE "SyncOperation" ADD CONSTRAINT "SyncOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncOperation" ADD CONSTRAINT "SyncOperation_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "CashRegister"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncOperation" ADD CONSTRAINT "SyncOperation_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
