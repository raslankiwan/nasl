/** UTC calendar arithmetic: choosing a month/year must not roll the selected day into the next. */
export function calendarDate(year: number, month: number, day = 1): Date {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(Math.max(day, 1), last)));
}

export function changeCalendarMonth(date: Date, months: number): Date {
  return calendarDate(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate());
}

/** Sunday-first grid; the view mirrors the whole grid for RTL so headings and days stay aligned. */
export function calendarDays(month: Date): Array<Date | null> {
  const year = month.getUTCFullYear();
  const index = month.getUTCMonth();
  const offset = calendarDate(year, index).getUTCDay();
  const count = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  const length = Math.ceil((offset + count) / 7) * 7;
  return Array.from({ length }, (_, cell) =>
    cell < offset || cell >= offset + count ? null : calendarDate(year, index, cell - offset + 1),
  );
}

export function clampCalendarDate(date: Date, min: Date, max: Date): Date {
  return new Date(Math.max(min.getTime(), Math.min(date.getTime(), max.getTime())));
}
