export const PAGE_SIZE = 50;
export type PageInfo = { page: number; total: number };
export function pageNumber(value: unknown): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, 1_000_000) : 1;
}
export type ListFilters = {
  q?: string;
  page?: number;
  category?: string;
  catalog?: string;
  stock?: string;
};
