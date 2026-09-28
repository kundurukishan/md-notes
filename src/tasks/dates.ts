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

function parseKey(key: string): Date {
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
