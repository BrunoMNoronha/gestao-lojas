// Fuso da loja: os períodos (hoje, semana, mês) e o "dia" dos relatórios seguem o relógio da
// loja, e não o do servidor (UTC na Vercel) nem o do navegador. Sem dependências externas.
export const STORE_TIME_ZONE = "America/Sao_Paulo";

export interface DateRange {
  from: Date;
  to: Date;
}

interface CalendarDay {
  year: number;
  month: number; // 1-12
  day: number;
}

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: STORE_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function zonedParts(date: Date) {
  const parts = partsFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

// Diferença (em ms) entre o relógio da loja e UTC no instante informado
function offsetMs(date: Date): number {
  const p = zonedParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converte um horário de parede da loja para o instante UTC correspondente. */
export function storeTimeToUtc(
  { year, month, day }: CalendarDay,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  let result = wallClock - offsetMs(new Date(wallClock));
  // Reajuste para o caso de o deslocamento mudar entre o palpite e o resultado (horário de verão)
  const corrected = wallClock - offsetMs(new Date(result));
  if (corrected !== result) result = corrected;
  return new Date(result);
}

/** Dia do calendário da loja no instante informado. */
export function storeCalendarDay(date: Date = new Date()): CalendarDay {
  const { year, month, day } = zonedParts(date);
  return { year, month, day };
}

// Soma dias em aritmética de calendário pura (sem fuso)
export function addDays({ year, month, day }: CalendarDay, days: number): CalendarDay {
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function formatDayKey({ year, month, day }: CalendarDay): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Valida e converte "YYYY-MM-DD"; devolve null se a data não existir. */
export function parseDayKey(value: unknown): CalendarDay | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** Quantidade de dias do calendário entre dois dias (inclusivo). */
export function countDays(from: CalendarDay, to: CalendarDay): number {
  const start = Date.UTC(from.year, from.month - 1, from.day);
  const end = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((end - start) / 86_400_000) + 1;
}

/** Intervalo UTC que cobre do início do dia `from` ao fim do dia `to` no fuso da loja. */
export function storeDayRange(from: CalendarDay, to: CalendarDay): DateRange {
  return {
    from: storeTimeToUtc(from),
    to: new Date(storeTimeToUtc(addDays(to, 1)).getTime() - 1),
  };
}

/** Hoje, semana corrente (segunda-feira 00:00) e mês corrente, até o momento atual. */
export function getStorePeriods(now: Date = new Date()) {
  const today = storeCalendarDay(now);
  const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;

  return {
    today: { from: storeTimeToUtc(today), to: now },
    week: { from: storeTimeToUtc(addDays(today, -daysSinceMonday)), to: now },
    month: { from: storeTimeToUtc({ ...today, day: 1 }), to: now },
  };
}

/** Primeiro dia do mês corrente e hoje, como "YYYY-MM-DD" (padrão dos relatórios). */
export function currentMonthDayKeys(now: Date = new Date()) {
  const today = storeCalendarDay(now);
  return { from: formatDayKey({ ...today, day: 1 }), to: formatDayKey(today) };
}

const storeDateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: STORE_TIME_ZONE,
  dateStyle: "short",
  timeStyle: "short",
});

/** Início (00:00 na loja) do dia em que o instante cai. */
export const startOfStoreDay = (date: Date = new Date()) => storeTimeToUtc(storeCalendarDay(date));

/**
 * Vencimento de um título com prazo de `days` dias corridos: 00:00 (fuso da loja) do dia da venda
 * + N. O título fica vencido a partir do dia seguinte ao vencimento (ver `isOverdue`).
 */
export const storeDueDate = (days: number, from: Date = new Date()) =>
  storeTimeToUtc(addDays(storeCalendarDay(from), days));

/** Vencido: o dia do vencimento já passou no relógio da loja (vencer hoje ainda não é atraso). */
export const isOverdue = (dueDate: Date | string, now: Date = new Date()) =>
  new Date(dueDate).getTime() < startOfStoreDay(now).getTime();

const storeDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: STORE_TIME_ZONE,
  dateStyle: "short",
});

/** Data (dd/mm/aaaa) no relógio da loja. */
export const formatStoreDate = (iso: string | Date) => storeDateFormatter.format(new Date(iso));

/** Data e hora no relógio da loja (igual no servidor e no navegador). */
export const formatStoreDateTime = (iso: string) => storeDateTimeFormatter.format(new Date(iso));

/** "YYYY-MM-DD" → "DD/MM/YYYY". */
export const formatDayKeyBR = (key: string) => key.split("-").reverse().join("/");
