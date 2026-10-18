-- Insights do negócio com o Claude (issue #113): chave da API cifrada em StoreSettings e histórico
-- das análises geradas. Aditiva; nenhuma linha existente muda.

-- CreateEnum
CREATE TYPE "BusinessInsightKind" AS ENUM ('REPORT', 'QUESTION');

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN     "anthropicApiKeyEnc" TEXT,
ADD COLUMN     "anthropicApiKeyHint" TEXT,
ADD COLUMN     "anthropicApiKeyUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BusinessInsight" (
    "id" TEXT NOT NULL,
    "kind" "BusinessInsightKind" NOT NULL,
    "periodFrom" TEXT NOT NULL,
    "periodTo" TEXT NOT NULL,
    "question" TEXT,
    "content" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costEstimate" DECIMAL(10,6) NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessInsight_createdAt_idx" ON "BusinessInsight"("createdAt");

-- CreateIndex
CREATE INDEX "BusinessInsight_kind_periodFrom_periodTo_createdAt_idx" ON "BusinessInsight"("kind", "periodFrom", "periodTo", "createdAt");

-- AddForeignKey
ALTER TABLE "BusinessInsight" ADD CONSTRAINT "BusinessInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
