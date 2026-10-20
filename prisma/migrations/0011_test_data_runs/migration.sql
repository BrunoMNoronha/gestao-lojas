-- Histórico da seção "Dados de teste" em Configurações (issue #57): geração de dados de teste e
-- restauração do banco. Só acrescenta enums, a tabela TestDataRun, índices e chave estrangeira;
-- nenhum dado existente é alterado.

-- CreateEnum
CREATE TYPE "TestDataRunKind" AS ENUM ('GENERATE', 'RESET');

-- CreateEnum
CREATE TYPE "TestDataRunStatus" AS ENUM ('COMPLETED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "TestDataRun" (
    "id" UUID NOT NULL,
    "kind" "TestDataRunKind" NOT NULL,
    "status" "TestDataRunStatus" NOT NULL,
    "userId" TEXT NOT NULL,
    "params" JSONB,
    "counts" JSONB,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestDataRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TestDataRun_kind_status_createdAt_idx" ON "TestDataRun"("kind", "status", "createdAt");

-- CreateIndex
CREATE INDEX "TestDataRun_userId_createdAt_idx" ON "TestDataRun"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "TestDataRun" ADD CONSTRAINT "TestDataRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

