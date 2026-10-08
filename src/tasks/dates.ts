// Due dates are date-only ('YYYY-MM-DD') in the user's local time.

export function toDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return toDateKey(d);
}

export function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function dueLabel(key: string): { label: string; overdue: boolean; today: boolean } {
  const date = parseKey(key);
  const days = Math.round((date.getTime() - parseKey(todayKey()).getTime()) / 86400000);
  let label: string;
  if (days === 0) label = 'Today';
  else if (days === 1) label = 'Tomorrow';
  else if (days === -1) label = 'Yesterday';
  else if (days > 1 && days < 7) label = date.toLocaleDateString(undefined, { weekday: 'long' });
  else {
    label = date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    });
  }
  return { label, overdue: days < 0, today: days === 0 };
}

// "Thursday, October 8, 2026": the title of a day's daily note.
export function longDate(key: string): string {
  return parseKey(key).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// First day of the week for the user's locale: 0 = Sunday, 1 = Monday, ...
export function firstDayOfWeek(): number {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const day = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    if (day) return day % 7; // Intl uses 1 = Monday ... 7 = Sunday
  } catch {
    // older engines: fall through
  }
  return 0;
}
