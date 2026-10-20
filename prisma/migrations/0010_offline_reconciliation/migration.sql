-- Telas de conciliação e envio assistido das vendas offline (issue #38, parte 3, docs/OFFLINE.md
-- seções 3.3 e 3.5). Só acrescenta: valor de enum, colunas opcionais, índice e chave estrangeira.

-- AlterEnum
ALTER TYPE "SyncConflictReason" ADD VALUE 'ASSISTED_SUBMISSION';

-- AlterTable
ALTER TABLE "OfflineGrant" ADD COLUMN     "pendingCount" INTEGER,
ADD COLUMN     "pendingReportedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SyncOperation" ADD COLUMN     "submittedById" TEXT;

-- CreateIndex
CREATE INDEX "OfflineGrant_cashRegisterId_idx" ON "OfflineGrant"("cashRegisterId");

-- AddForeignKey
ALTER TABLE "SyncOperation" ADD CONSTRAINT "SyncOperation_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

