import { describe, expect, it } from "vitest";
import { mapsUrl, parseGeoPoint } from "@/lib/catalog-shared";

describe("parseGeoPoint", () => {
  it("trata localização ausente como opcional", () => {
    expect(parseGeoPoint(undefined)).toBeNull();
    expect(parseGeoPoint(null)).toBeNull();
  });

  it("arredonda coordenadas a 6 casas e a precisão a metros inteiros", () => {
    expect(parseGeoPoint({ lat: -23.55052012, lng: -46.63330899, accuracy: 12.6 })).toEqual({
      lat: -23.55052,
      lng: -46.633309,
      accuracy: 13,
    });
  });

  it("rejeita coordenadas fora da faixa ou que não são números", () => {
    expect(parseGeoPoint({ lat: 91, lng: 0 })).toBe("invalid");
    expect(parseGeoPoint({ lat: 0, lng: -181 })).toBe("invalid");
    expect(parseGeoPoint({ lat: "-23.5", lng: -46.6 })).toBe("invalid");
    expect(parseGeoPoint({ lat: Number.NaN, lng: -46.6 })).toBe("invalid");
    expect(parseGeoPoint("-23.5,-46.6")).toBe("invalid");
  });

  it("descarta precisão inválida sem rejeitar a posição", () => {
    expect(parseGeoPoint({ lat: 1, lng: 2, accuracy: -5 })).toEqual({ lat: 1, lng: 2 });
    expect(parseGeoPoint({ lat: 1, lng: 2, accuracy: "10" })).toEqual({ lat: 1, lng: 2 });
  });
});

describe("mapsUrl", () => {
  it("gera o link do Google Maps para a posição", () => {
    expect(mapsUrl({ lat: -23.55052, lng: -46.633309 })).toBe(
      "https://www.google.com/maps?q=-23.55052,-46.633309",
    );
  });
});
