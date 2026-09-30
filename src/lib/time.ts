/**
 * Time helpers shared by the peak engine, the API and the UI so a window is
 * labelled identically everywhere.
 */

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
] as const;

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** "16" -> 16:00 */
export function parseClock(value: string): number {
  const [raw] = String(value ?? '').split(':');
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return 0;
  return Math.min(23, Math.max(0, parsed));
}

/** 0 -> "12 AM", 13 -> "1 PM" */
export function formatHourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${suffix}`;
}

/** 16.5 -> "4:30 PM" */
export function formatClockTime(hour: number, minute = 0): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const m = Math.max(0, Math.min(59, Math.round(minute)));
  const suffix = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:${pad2(m)} ${suffix}`;
}

/** [16, 18] -> "4:00 PM – 6:00 PM" */
export function formatHourWindow(startHour: number, endHour: number): string {
  return `${formatHourLabel(startHour)} – ${formatHourLabel(endHour)}`;
}

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return dateKey(a) === dateKey(b);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

export function minutesIntoDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Days between two YYYY-MM-DD keys (b - a). */
export function daysBetween(aKey: string, bKey: string): number {
  const a = new Date(`${aKey}T00:00:00`);
  const b = new Date(`${bKey}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
