import { describe, expect, it } from "vitest";
import { suggestSalePrice } from "@/lib/pricing";

describe("suggestSalePrice", () => {
  it("aplica a margem sobre o custo", () => {
    expect(suggestSalePrice(10, 30)).toBe(13);
    expect(suggestSalePrice(10, 150)).toBe(25);
  });

  it("arredonda ao centavo", () => {
    expect(suggestSalePrice(7.99, 35)).toBe(10.79);
    expect(suggestSalePrice(0.1, 33.33)).toBe(0.13);
  });

  it("margem zero mantém o custo", () => {
    expect(suggestSalePrice(12.5, 0)).toBe(12.5);
  });
});
