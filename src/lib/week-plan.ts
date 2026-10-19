export type CalendarPace = {
  line: string;
  perWeek: number | null;
  weeks: number | null;
};

function amount(raw: string) {
  return Number(raw.replace(",", "."));
}

export function calendarPace(lines: string[], totalHours: number): CalendarPace | null {
  const line = lines.find((item) => /календарн/i.test(item));
  if (!line) return null;

  const sessions = line.match(/(\d+(?:[.,]\d+)?)\s+занят/i);
  const sessionHours = line.match(/по\s+(\d+(?:[.,]\d+)?)\s+час/i);
  const weeksMatch = line.match(/(\d+)\s+недел/i);
  const weeks = weeksMatch ? Number(weeksMatch[1]) : null;

  let perWeek: number | null = null;
  if (weeks && sessions && sessionHours) {
    perWeek = (amount(sessions[1]) * amount(sessionHours[1])) / weeks;
  } else if (weeks && totalHours > 0) {
    perWeek = totalHours / weeks;
  }

  if (perWeek == null || !Number.isFinite(perWeek) || perWeek <= 0) {
    return { line, perWeek: null, weeks };
  }

  const snapped = Math.min(40, Math.max(0.5, Math.round(perWeek * 2) / 2));
  return { line, perWeek: snapped, weeks };
}
