-- Contato do pedido do catálogo (issue #81): nome e telefone informados no carrinho, vindos do
-- link criptografado, e vínculo opcional com o cliente cadastrado de mesmo telefone. Aditiva.

-- AlterTable
ALTER TABLE "CatalogOrder" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "customerPhone" TEXT;

-- CreateIndex
CREATE INDEX "CatalogOrder_customerId_idx" ON "CatalogOrder"("customerId");

-- AddForeignKey
ALTER TABLE "CatalogOrder" ADD CONSTRAINT "CatalogOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

