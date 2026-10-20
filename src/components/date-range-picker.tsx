"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { ptBR } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  type CalendarDay,
  addDays,
  formatDayKey,
  formatDayKeyBR,
  parseDayKey,
  storeCalendarDay,
} from "@/lib/store-time";
import { cn } from "@/lib/utils";

export interface DayKeyRange {
  from: string;
  to: string;
}

interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (range: DayKeyRange) => void;
  // id aplicado ao gatilho, para associar a um <Label htmlFor>
  id?: string;
  placeholder?: string;
  // Exibe "Limpar" no popover (filtros em que o período é opcional)
  clearable?: boolean;
  className?: string;
  "aria-label"?: string;
}

// O calendário trabalha com Date local; aqui só importa o dia do calendário, sem fuso
const toDate = ({ year, month, day }: CalendarDay) => new Date(year, month - 1, day);
const toDayKey = (date: Date) =>
  formatDayKey({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
const keyToDate = (key: string) => {
  const day = parseDayKey(key);
  return day ? toDate(day) : undefined;
};

// Atalhos a partir de "hoje" no fuso da loja
function getPresets(today: CalendarDay): { label: string; range: DayKeyRange }[] {
  const range = (from: CalendarDay, to: CalendarDay) => ({
    from: formatDayKey(from),
    to: formatDayKey(to),
  });
  const lastMonthEnd = addDays({ ...today, day: 1 }, -1);

  return [
    { label: "Hoje", range: range(today, today) },
    { label: "Ontem", range: range(addDays(today, -1), addDays(today, -1)) },
    { label: "Últimos 7 dias", range: range(addDays(today, -6), today) },
    { label: "Últimos 30 dias", range: range(addDays(today, -29), today) },
    { label: "Este mês", range: range({ ...today, day: 1 }, today) },
    { label: "Mês passado", range: range({ ...lastMonthEnd, day: 1 }, lastMonthEnd) },
  ];
}

// Seletor de período (De/Até) num único campo, com valores "YYYY-MM-DD"
export function DateRangePicker({
  from,
  to,
  onChange,
  id,
  placeholder = "Selecionar período",
  clearable,
  className,
  ...aria
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  // Início escolhido no 1º clique; o período só é aplicado no 2º, para não recarregar no meio
  const [pendingStart, setPendingStart] = useState<Date | null>(null);

  const today = storeCalendarDay();
  const fromDate = keyToDate(from);
  const toDateValue = keyToDate(to);
  const lastMonth = parseDayKey(to) ?? today;
  const selected = pendingStart
    ? { from: pendingStart, to: undefined }
    : fromDate
      ? { from: fromDate, to: toDateValue }
      : undefined;

  const label =
    from && to
      ? from === to
        ? formatDayKeyBR(from)
        : `${formatDayKeyBR(from)} – ${formatDayKeyBR(to)}`
      : from
        ? `A partir de ${formatDayKeyBR(from)}`
        : to
          ? `Até ${formatDayKeyBR(to)}`
          : null;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    setPendingStart(null);
  };

  const apply = (range: DayKeyRange) => {
    onChange(range);
    handleOpenChange(false);
  };

  const handleDayClick = (day: Date) => {
    if (!pendingStart) {
      setPendingStart(day);
      return;
    }
    const [start, end] = day < pendingStart ? [day, pendingStart] : [pendingStart, day];
    apply({ from: toDayKey(start), to: toDayKey(end) });
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            className={cn("w-full justify-start font-normal", className)}
            {...aria}
          />
        }
      >
        <CalendarDays className="text-muted-foreground" />
        <span className={cn("truncate", !label && "text-muted-foreground")}>
          {label ?? placeholder}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto gap-0 p-0 sm:flex-row">
        <div className="flex flex-wrap gap-1 border-b p-2 sm:w-36 sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0">
          {getPresets(today).map((preset) => (
            <Button
              key={preset.label}
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => apply(preset.range)}
            >
              {preset.label}
            </Button>
          ))}
          {clearable && (from || to) && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground justify-start sm:mt-auto"
              onClick={() => apply({ from: "", to: "" })}
            >
              Limpar
            </Button>
          )}
        </div>
        <div className="flex flex-col">
          <Calendar
            mode="range"
            locale={ptBR}
            numberOfMonths={2}
            showOutsideDays={false}
            // Os dois meses visíveis terminam no mês da data final (ou no atual)
            defaultMonth={new Date(lastMonth.year, lastMonth.month - 2, 1)}
            endMonth={toDate(today)}
            selected={selected}
            onSelect={(_, day) => handleDayClick(day)}
            disabled={{ after: toDate(today) }}
          />
          <p className="text-muted-foreground px-3 pb-2 text-xs">
            {pendingStart ? "Selecione a data final" : "Selecione a data inicial"}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
