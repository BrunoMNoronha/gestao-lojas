-- Estorno de venda: venda marcada como estornada (sai dos totais), sangria de devolução ligada
-- à venda e título do Fiado cancelado. Só colunas e um valor de enum novos; nada é recalculado.

-- AlterEnum
ALTER TYPE "ReceivableStatus" ADD VALUE 'CANCELED';

-- AlterTable
ALTER TABLE "CashMovement" ADD COLUMN     "saleId" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedById" TEXT,
ADD COLUMN     "reversedInRegister" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "CashMovement_saleId_idx" ON "CashMovement"("saleId");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
