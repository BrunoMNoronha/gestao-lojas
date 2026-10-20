-- Marcação dos registros gerados pela seção "Dados de teste" (issue #67), para removê-los sem
-- tocar nos dados reais. Só acrescenta um valor ao enum e colunas opcionais; nenhum dado existente
-- é alterado (registros gerados antes desta migration ficam sem marcação).

-- AlterEnum
ALTER TYPE "TestDataRunKind" ADD VALUE 'CLEANUP';

-- AlterTable
ALTER TABLE "Category" ADD COLUMN "testDataRunId" UUID;
ALTER TABLE "Product" ADD COLUMN "testDataRunId" UUID;
ALTER TABLE "Customer" ADD COLUMN "testDataRunId" UUID;
ALTER TABLE "Supplier" ADD COLUMN "testDataRunId" UUID;
ALTER TABLE "StockMovement" ADD COLUMN "testDataRunId" UUID;
