-- Margem de lucro padrão (% sobre o custo) para sugerir o preço de venda no cadastro de produto.
-- Coluna nula: lojas existentes continuam sem sugestão.

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN     "defaultProfitMargin" DECIMAL(6,2);
