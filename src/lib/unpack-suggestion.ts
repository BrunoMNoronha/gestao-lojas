// Sugestão de abertura no PDV: o saldo avulso e as caixas no carrinho nunca contam duas vezes.
export interface UnpackProduct {
  id: string;
  name: string;
  unit: string;
  currentStock: number;
  containedProductId?: string | null;
  unitsPerBox?: number | null;
}

export interface UnpackSuggestion<T extends UnpackProduct = UnpackProduct> {
  boxProduct: T;
  unitProduct: T;
  boxQuantity: number;
  reservedBoxes: number;
}

export function suggestUnpack<T extends UnpackProduct>(
  products: T[],
  unitProductId: string,
  requestedQuantity: number,
  cart: { productId: string; quantity: number }[],
): UnpackSuggestion<T> | null {
  const unitProduct = products.find((p) => p.id === unitProductId);
  if (
    !unitProduct ||
    unitProduct.unit !== "UN" ||
    !Number.isSafeInteger(requestedQuantity) ||
    requestedQuantity <= 0 ||
    !Number.isSafeInteger(unitProduct.currentStock) ||
    unitProduct.currentStock < 0 ||
    requestedQuantity <= unitProduct.currentStock
  )
    return null;

  // Cada avulso tem uma única caixa de origem. Uma cópia incoerente não decide pela loja.
  const sources = products.filter((p) => p.containedProductId === unitProductId);
  if (sources.length !== 1) return null;
  const boxProduct = sources[0];
  const factor = boxProduct.unitsPerBox;
  if (
    boxProduct.unit !== "CX" ||
    !Number.isSafeInteger(factor) ||
    !factor ||
    factor < 2 ||
    factor > 1_000_000 ||
    !Number.isSafeInteger(boxProduct.currentStock) ||
    boxProduct.currentStock < 0
  )
    return null;
  const reservedBoxes = cart
    .filter((i) => i.productId === boxProduct.id)
    .reduce((sum, i) => sum + i.quantity, 0);
  if (!Number.isSafeInteger(reservedBoxes) || reservedBoxes < 0) return null;
  const boxQuantity = Math.ceil((requestedQuantity - unitProduct.currentStock) / factor);
  if (
    boxQuantity > 1_000_000 ||
    boxQuantity * factor > 1_000_000 ||
    boxQuantity > boxProduct.currentStock - reservedBoxes
  )
    return null;
  return { boxProduct, unitProduct, boxQuantity, reservedBoxes };
}
