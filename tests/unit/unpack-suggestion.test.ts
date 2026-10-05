import { describe, expect, it } from "vitest";
import { suggestUnpack, type UnpackProduct } from "@/lib/unpack-suggestion";

const unit: UnpackProduct = { id: "can", name: "Lata", unit: "UN", currentStock: 0 };
const box: UnpackProduct = {
  id: "box",
  name: "Caixa",
  unit: "CX",
  currentStock: 3,
  containedProductId: "can",
  unitsPerBox: 12,
};

describe("suggestUnpack", () => {
  it("abre o mínimo para o total desejado, usando primeiro as unidades disponíveis", () => {
    expect(suggestUnpack([unit, box], "can", 1, [])?.boxQuantity).toBe(1);
    expect(suggestUnpack([unit, box], "can", 13, [])?.boxQuantity).toBe(2);
    expect(suggestUnpack([{ ...unit, currentStock: 5 }, box], "can", 13, [])?.boxQuantity).toBe(1);
    expect(suggestUnpack([{ ...unit, currentStock: 5 }, box], "can", 5, [])).toBeNull();
  });
  it("preserva as caixas já no carrinho e não permite gastar a mesma caixa duas vezes", () => {
    expect(suggestUnpack([unit, box], "can", 13, [{ productId: "box", quantity: 2 }])).toBeNull();
    expect(suggestUnpack([unit, box], "can", 1, [{ productId: "box", quantity: 2 }])).toMatchObject(
      { boxQuantity: 1, reservedBoxes: 2 },
    );
    expect(suggestUnpack([unit, box], "can", 1, [{ productId: "box", quantity: 3 }])).toBeNull();
  });
  it("não cria estoque com saldo insuficiente, negativo ou fator inválido", () => {
    expect(suggestUnpack([unit, { ...box, currentStock: 0 }], "can", 1, [])).toBeNull();
    expect(suggestUnpack([{ ...unit, currentStock: -1 }, box], "can", 1, [])).toBeNull();
    for (const unitsPerBox of [null, undefined, 0, 1, -1, 1.5, NaN]) {
      expect(suggestUnpack([unit, { ...box, unitsPerBox }], "can", 1, [])).toBeNull();
    }
  });
  it("recusa vínculos ambíguos ou ausentes e quantidade fracionada", () => {
    expect(suggestUnpack([unit], "can", 1, [])).toBeNull();
    expect(suggestUnpack([unit, box, { ...box, id: "box2" }], "can", 1, [])).toBeNull();
    expect(suggestUnpack([unit, box], "can", 1.5, [])).toBeNull();
    expect(suggestUnpack([unit, { ...box, unitsPerBox: undefined }], "can", 1, [])).toBeNull();
  });
});
