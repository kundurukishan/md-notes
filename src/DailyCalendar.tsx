import { useEffect, useMemo, useState } from 'react';
import { firstDayOfWeek, longDate, parseKey, toDateKey, todayKey } from './tasks/dates';
import { IconChevron } from './Icons';

interface DailyCalendarProps {
  // Dates (YYYY-MM-DD) that have a daily note.
  noteDates: Set<string>;
  // The date of the daily note that's open, if any.
  selected: string | null;
  onPick: (date: string) => void;
}

// Month calendar shown above the daily notes list. Days with a note get a
// dot; clicking any day opens (or starts) that day's note.
export function DailyCalendar({ noteDates, selected, onPick }: DailyCalendarProps) {
  const today = todayKey();
  const [month, setMonth] = useState(() => monthOf(selected ?? today));

  // Follow the open note to its month.
  useEffect(() => {
    if (selected) setMonth(monthOf(selected));
  }, [selected]);

  const weekStart = useMemo(firstDayOfWeek, []);
  const weekdays = useMemo(() => {
    const names: string[] = [];
    for (let i = 0; i < 7; i++) {
      // 2023-01-01 was a Sunday.
      names.push(new Date(2023, 0, 1 + ((weekStart + i) % 7)).toLocaleDateString(undefined, { weekday: 'narrow' }));
    }
    return names;
  }, [weekStart]);

  const cells = useMemo(() => {
    const first = new Date(month.year, month.month, 1);
    const offset = (first.getDay() - weekStart + 7) % 7;
    const start = new Date(month.year, month.month, 1 - offset);
    const days: { key: string; day: number; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      days.push({ key: toDateKey(d), day: d.getDate(), inMonth: d.getMonth() === month.month });
    }
    // Drop a trailing week that is entirely in the next month.
    return days.slice(35).every((d) => !d.inMonth) ? days.slice(0, 35) : days;
  }, [month, weekStart]);

  const label = new Date(month.year, month.month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const shift = (delta: number) => setMonth((m) => monthOf(toDateKey(new Date(m.year, m.month + delta, 1))));
  const notesThisMonth = cells.filter((c) => c.inMonth && noteDates.has(c.key)).length;

  return (
    <div className="calendar" aria-label="Daily notes calendar">
      <div className="calendar-header">
        <button className="icon-button calendar-nav prev" onClick={() => shift(-1)} aria-label="Previous month">
          <IconChevron size={14} />
        </button>
        <div className="calendar-title">
          <span>{label}</span>
          <span className="calendar-count">{notesThisMonth ? `${notesThisMonth} ${notesThisMonth === 1 ? 'note' : 'notes'}` : ''}</span>
        </div>
        <button className="icon-button calendar-nav" onClick={() => shift(1)} aria-label="Next month">
          <IconChevron size={14} />
        </button>
        <button className="calendar-today" onClick={() => onPick(today)}>
          Today
        </button>
      </div>
      <div className="calendar-grid" role="grid">
        {weekdays.map((w, i) => (
          <div key={`w${i}`} className="calendar-weekday" aria-hidden="true">
            {w}
          </div>
        ))}
        {cells.map((c) => (
          <button
            key={c.key}
            className={[
              'calendar-day',
              c.inMonth ? '' : 'outside',
              c.key === today ? 'today' : '',
              c.key === selected ? 'selected' : '',
              noteDates.has(c.key) ? 'has-note' : '',
            ].join(' ')}
            onClick={() => onPick(c.key)}
            aria-label={`${longDate(c.key)}${noteDates.has(c.key) ? ', has a note' : ''}`}
            aria-current={c.key === today ? 'date' : undefined}
          >
            {c.day}
          </button>
        ))}
      </div>
    </div>
  );
}

function monthOf(key: string) {
  const d = parseKey(key);
  return { year: d.getFullYear(), month: d.getMonth() };
}
