import { MovementType, Prisma, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockOpenCashRegister } from "@/lib/cash-register";
import { hashPayload, parseOperationId } from "@/lib/sync-operation";

export interface UnpackInput {
  operationId: string;
  boxProductId: string;
  expectedUnitProductId: string;
  expectedUnitsPerBox: number;
  boxQuantity: number;
  reservedBoxes?: number;
}

export type UnpackResult =
  | {
      success: true;
      data: {
        conversionId: string;
        boxProductId: string;
        unitProductId: string;
        boxQuantity: number;
        unitQuantity: number;
        replayed: boolean;
        appliedTxid: string;
      };
    }
  | { success: false; error: string; uncertain?: boolean };

export class UnpackValidationError extends Error {}

const MAX_QUANTITY = 1_000_000;
const MAX_STOCK = new Prisma.Decimal("9999999.999");
const CONFLICT =
  "Esta abertura já foi enviada com outros dados ou por outro operador. Confira o histórico antes de tentar novamente.";

/** Vínculos ficam estáveis enquanto as linhas são travadas em ordem de id.
 * Aberturas compartilham a trava; cadastro e exclusão usam a trava exclusiva.
 */
export async function lockUnpackConfiguration(tx: Prisma.TransactionClient, exclusive = false) {
  if (exclusive) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('product-unpack-config'))::text`;
  } else {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtext('product-unpack-config'))::text`;
  }
}

export async function lockUnpackProducts(tx: Prisma.TransactionClient, ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  if (!sorted.length) return;
  await tx.$queryRaw`
    SELECT "id" FROM "Product" WHERE "id" IN (${Prisma.join(sorted)}) ORDER BY "id" FOR UPDATE
  `;
}

function parseInput(data: UnpackInput) {
  const operationId = parseOperationId(data?.operationId);
  if (!operationId)
    throw new UnpackValidationError("Identificador da abertura inválido. Atualize a tela.");
  if (
    typeof data.boxProductId !== "string" ||
    !data.boxProductId ||
    typeof data.expectedUnitProductId !== "string" ||
    !data.expectedUnitProductId
  ) {
    throw new UnpackValidationError("Selecione a caixa e o produto avulso vinculados.");
  }
  const boxQuantity = data.boxQuantity;
  const factor = data.expectedUnitsPerBox;
  const reservedBoxes = data.reservedBoxes ?? 0;
  if (!Number.isInteger(boxQuantity) || boxQuantity <= 0 || boxQuantity > MAX_QUANTITY) {
    throw new UnpackValidationError(
      "Informe uma quantidade inteira de caixas maior que zero, até 1.000.000.",
    );
  }
  if (!Number.isInteger(factor) || factor < 2 || factor > MAX_QUANTITY) {
    throw new UnpackValidationError(
      "Quantidade de unidades por caixa inválida. Atualize o cadastro.",
    );
  }
  if (!Number.isInteger(reservedBoxes) || reservedBoxes < 0 || reservedBoxes > MAX_QUANTITY) {
    throw new UnpackValidationError("Quantidade de caixas no carrinho inválida.");
  }
  const unitQuantity = boxQuantity * factor;
  if (unitQuantity > MAX_QUANTITY) {
    throw new UnpackValidationError(
      "A abertura pode gerar no máximo 1.000.000 de unidades por operação.",
    );
  }
  return {
    operationId,
    boxProductId: data.boxProductId,
    unitProductId: data.expectedUnitProductId,
    factor,
    boxQuantity,
    unitQuantity,
    reservedBoxes,
  };
}

/** A confirmação grava a abertura física imediatamente. A venda é uma operação separada. */
export async function registerUnpack(
  userId: string,
  input: UnpackInput,
  source: "stock" | "pdv" = "stock",
): Promise<UnpackResult> {
  try {
    const data = parseInput(input);
    const payloadHash = hashPayload({
      v: 1,
      source,
      boxProductId: data.boxProductId,
      unitProductId: data.unitProductId,
      factor: data.factor,
      boxQuantity: data.boxQuantity,
      reservedBoxes: data.reservedBoxes,
    });

    return await prisma.$transaction(async (tx): Promise<UnpackResult> => {
      // Uma chave nova ainda não tem linha para travar. A trava serializa o primeiro envio
      // com repetições sem gravar efeitos antes de validar payload e autoria.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`unpack:${data.operationId}`}))::text`;
      const existing = await tx.unpackConversion.findUnique({ where: { id: data.operationId } });
      if (existing) {
        if (existing.userId !== userId || existing.payloadHash !== payloadHash) {
          throw new UnpackValidationError(CONFLICT);
        }
        return {
          success: true,
          data: {
            conversionId: existing.id,
            boxProductId: existing.boxProductId,
            unitProductId: existing.unitProductId,
            boxQuantity: existing.boxQuantity,
            unitQuantity: existing.unitQuantity,
            replayed: true,
            appliedTxid: existing.appliedTxid.toString(),
          },
        };
      }
      if (source === "pdv" && !(await lockOpenCashRegister(tx, userId))) {
        throw new UnpackValidationError("Abra seu caixa antes de abrir caixas de produtos no PDV.");
      }
      await lockUnpackConfiguration(tx);
      await lockUnpackProducts(tx, [data.boxProductId, data.unitProductId]);
      const products = await tx.product.findMany({
        where: { id: { in: [data.boxProductId, data.unitProductId] }, deletedAt: null },
      });
      const box = products.find((p) => p.id === data.boxProductId);
      const unit = products.find((p) => p.id === data.unitProductId);
      if (!box || !unit)
        throw new UnpackValidationError("Caixa ou produto avulso não encontrado. Atualize a tela.");
      if (
        box.unit !== Unit.CX ||
        unit.unit !== Unit.UN ||
        box.containedProductId !== unit.id ||
        box.unitsPerBox !== data.factor
      ) {
        throw new UnpackValidationError(
          "O vínculo ou a quantidade por caixa mudou. Atualize a tela antes de abrir.",
        );
      }
      if (box.currentStock.lt(data.boxQuantity + data.reservedBoxes)) {
        throw new UnpackValidationError(
          "Caixas insuficientes para abrir e manter as caixas do carrinho.",
        );
      }
      if (unit.currentStock.add(data.unitQuantity).gt(MAX_STOCK)) {
        throw new UnpackValidationError(
          "O saldo de unidades excederia o limite de estoque permitido.",
        );
      }
      if (box.costPrice.lt(0))
        throw new UnpackValidationError("Corrija o preço de custo da caixa antes de abrir.");

      const totalCost = box.costPrice.mul(data.boxQuantity);
      const totalCents = totalCost.mul(100);
      const baseCents = totalCents.div(data.unitQuantity).floor();
      const unitCostBase = baseCents.div(100);
      const extraCostUnits = totalCents.sub(baseCents.mul(data.unitQuantity)).toNumber();
      const [transaction] = await tx.$queryRaw<
        { txid: string }[]
      >`SELECT pg_current_xact_id()::text AS txid`;
      const conversion = await tx.unpackConversion.create({
        data: {
          id: data.operationId,
          payloadHash,
          boxProductId: box.id,
          unitProductId: unit.id,
          boxProductName: box.name,
          unitProductName: unit.name,
          unitsPerBox: data.factor,
          boxQuantity: data.boxQuantity,
          unitQuantity: data.unitQuantity,
          boxUnitCost: box.costPrice,
          totalCost,
          unitCostBase,
          extraCostUnits,
          userId,
          appliedTxid: BigInt(transaction.txid),
        },
      });
      const deducted = await tx.product.updateMany({
        where: {
          id: box.id,
          deletedAt: null,
          currentStock: { gte: data.boxQuantity + data.reservedBoxes },
        },
        data: { currentStock: { decrement: data.boxQuantity } },
      });
      if (deducted.count !== 1)
        throw new UnpackValidationError("O estoque de caixas mudou. Atualize a tela.");
      await tx.product.update({
        where: { id: unit.id },
        data: { currentStock: { increment: data.unitQuantity } },
      });
      const reason = `Abertura de ${data.boxQuantity} caixa(s): ${data.factor} unidades por caixa`;
      await tx.stockMovement.createMany({
        data: [
          {
            productId: box.id,
            type: MovementType.OUT,
            quantity: data.boxQuantity,
            unitCost: box.costPrice,
            totalCost,
            reason,
            userId,
            conversionId: conversion.id,
            createdAt: conversion.createdAt,
          },
          {
            productId: unit.id,
            type: MovementType.IN,
            quantity: data.unitQuantity,
            unitCost: unitCostBase,
            totalCost,
            reason,
            userId,
            conversionId: conversion.id,
            createdAt: conversion.createdAt,
          },
        ],
      });
      return {
        success: true,
        data: {
          conversionId: conversion.id,
          boxProductId: box.id,
          unitProductId: unit.id,
          boxQuantity: data.boxQuantity,
          unitQuantity: data.unitQuantity,
          replayed: false,
          appliedTxid: conversion.appliedTxid.toString(),
        },
      };
    });
  } catch (error) {
    if (error instanceof UnpackValidationError) return { success: false, error: error.message };
    console.error("Erro ao abrir caixas:", error);
    return {
      success: false,
      uncertain: true,
      error: "Falha ao registrar a abertura de caixas. Tente novamente com a mesma confirmação.",
    };
  }
}
