import {
  dayComponents,
  daysInMonth,
  firstOccurrenceAfter,
  isDue,
  isSameDay,
  isSameOrBeforeDay,
  isWithinEnd,
  nextOccurrence,
  noonOf,
} from './date';

/**
 * Recurrence date math — pure, TZ-independent (every fixture is built from
 * local calendar components via `noonOf`, so the assertions hold in any
 * timezone the suite runs in).
 */

/** Local noon helpers for readable fixtures. */
const d = (year: number, month: number, day: number) =>
  noonOf(year, month, day);
const components = (ms: number) => {
  const c = dayComponents(ms);
  return `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
};

describe('daysInMonth', () => {
  it('returns the correct lengths including leap-year February', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28); // non-leap
    expect(daysInMonth(2028, 2)).toBe(29); // leap
    expect(daysInMonth(2000, 2)).toBe(29); // divisible by 400
    expect(daysInMonth(2100, 2)).toBe(28); // divisible by 100 but not 400
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('nextOccurrence — daily', () => {
  it('advances one calendar day', () => {
    expect(components(nextOccurrence(d(2026, 9, 8), 'daily'))).toBe(
      '2026-09-09',
    );
  });

  it('rolls across month boundaries', () => {
    expect(components(nextOccurrence(d(2026, 8, 31), 'daily'))).toBe(
      '2026-09-01',
    );
  });

  it('rolls across year boundaries', () => {
    expect(components(nextOccurrence(d(2026, 12, 31), 'daily'))).toBe(
      '2027-01-01',
    );
  });
});

describe('nextOccurrence — weekly', () => {
  it('advances seven calendar days', () => {
    expect(components(nextOccurrence(d(2026, 9, 8), 'weekly'))).toBe(
      '2026-09-15',
    );
  });

  it('rolls across month boundaries without drift', () => {
    expect(components(nextOccurrence(d(2026, 1, 30), 'weekly'))).toBe(
      '2026-02-06',
    );
  });

  it('rolls across year boundaries', () => {
    expect(components(nextOccurrence(d(2026, 12, 29), 'weekly'))).toBe(
      '2027-01-05',
    );
  });
});

describe('nextOccurrence — monthly', () => {
  it('keeps the day of month', () => {
    expect(components(nextOccurrence(d(2026, 9, 8), 'monthly'))).toBe(
      '2026-10-08',
    );
  });

  it('clamps to the last valid day of shorter months (documented rule)', () => {
    // Jan 31 -> Feb 28 (2026 is not a leap year)
    expect(components(nextOccurrence(d(2026, 1, 31), 'monthly'))).toBe(
      '2026-02-28',
    );
    // ...and the anchor advances from the CLAMPED date: Feb 28 -> Mar 28.
    expect(components(nextOccurrence(d(2026, 2, 28), 'monthly'))).toBe(
      '2026-03-28',
    );
    // Aug 31 -> Sep 30 -> Oct 30.
    expect(components(nextOccurrence(d(2026, 8, 31), 'monthly'))).toBe(
      '2026-09-30',
    );
    expect(components(nextOccurrence(d(2026, 9, 30), 'monthly'))).toBe(
      '2026-10-30',
    );
  });

  it('handles leap-year February safely', () => {
    // Jan 31 in a leap year -> Feb 29 -> Mar 29.
    expect(components(nextOccurrence(d(2028, 1, 31), 'monthly'))).toBe(
      '2028-02-29',
    );
    expect(components(nextOccurrence(d(2028, 2, 29), 'monthly'))).toBe(
      '2028-03-29',
    );
  });

  it('rolls December -> January of the next year', () => {
    expect(components(nextOccurrence(d(2026, 12, 8), 'monthly'))).toBe(
      '2027-01-08',
    );
    expect(components(nextOccurrence(d(2026, 12, 31), 'monthly'))).toBe(
      '2027-01-31',
    );
  });
});

describe('isSameDay / isSameOrBeforeDay', () => {
  it('compares calendar days, not raw millis', () => {
    const noon = d(2026, 9, 8);
    const midnight = new Date(2026, 8, 8, 0, 0, 0, 0).getTime();
    expect(isSameDay(noon, midnight)).toBe(true);
    expect(isSameOrBeforeDay(midnight, noon)).toBe(true);
    expect(isSameOrBeforeDay(noon, midnight)).toBe(true);
  });

  it('orders distinct days deterministically', () => {
    expect(isSameOrBeforeDay(d(2026, 9, 7), d(2026, 9, 8))).toBe(true);
    expect(isSameOrBeforeDay(d(2026, 9, 8), d(2026, 9, 7))).toBe(false);
  });
});

describe('isDue', () => {
  it('is true for today and any earlier day', () => {
    const now = d(2026, 9, 8);
    expect(isDue(d(2026, 9, 8), now)).toBe(true);
    expect(isDue(d(2026, 9, 1), now)).toBe(true);
    expect(isDue(d(2025, 1, 1), now)).toBe(true);
  });

  it('is false for future occurrences (spec §18)', () => {
    const now = d(2026, 9, 8);
    expect(isDue(d(2026, 9, 9), now)).toBe(false);
    expect(isDue(d(2026, 10, 1), now)).toBe(false);
  });
});

describe('isWithinEnd', () => {
  it('treats the end date as inclusive', () => {
    const end = d(2026, 9, 30);
    expect(isWithinEnd(d(2026, 9, 30), end)).toBe(true);
    expect(isWithinEnd(d(2026, 9, 29), end)).toBe(true);
    expect(isWithinEnd(d(2026, 10, 1), end)).toBe(false);
  });

  it('never bounds when the end date is null', () => {
    expect(isWithinEnd(d(2100, 1, 1), null)).toBe(true);
  });
});

describe('firstOccurrenceAfter (resume skip-forward)', () => {
  it('returns the first occurrence strictly after today', () => {
    // Monthly rule whose next occurrence (Aug 1) is stale relative to
    // Sep 8: Aug 1 and Sep 1 are skipped; Oct 1 is the first future day.
    expect(
      components(firstOccurrenceAfter(d(2026, 8, 1), 'monthly', d(2026, 9, 8))),
    ).toBe('2026-10-01');
  });

  it('advances daily rules to tomorrow', () => {
    expect(
      components(firstOccurrenceAfter(d(2026, 9, 1), 'daily', d(2026, 9, 8))),
    ).toBe('2026-09-09');
  });

  it('keeps a next occurrence that is already in the future', () => {
    expect(
      components(
        firstOccurrenceAfter(d(2026, 10, 1), 'monthly', d(2026, 9, 8)),
      ),
    ).toBe('2026-10-01');
  });

  it('skips only up to and including today, never tomorrow', () => {
    expect(
      components(firstOccurrenceAfter(d(2026, 9, 8), 'weekly', d(2026, 9, 8))),
    ).toBe('2026-09-15');
  });
});
