import { DateTime } from 'luxon';

const BERLIN_TIMEZONE = 'Europe/Berlin';

type DateInput = Date | number | undefined;

function normalizeInput(input?: DateInput): Date {
  if (input instanceof Date) {
    return input;
  }

  if (typeof input === 'number') {
    return new Date(input);
  }

  return new Date();
}

export function toBerlinDateTime(input?: DateInput): DateTime {
  return DateTime.fromJSDate(normalizeInput(input), { zone: BERLIN_TIMEZONE });
}

export function getBerlinDate(input?: DateInput): string {
  return toBerlinDateTime(input).toFormat('yyyy-MM-dd');
}

export function getBerlinTimestamp(input?: DateInput): string {
  const isoString = toBerlinDateTime(input).toISO();

  if (!isoString) {
    throw new Error('Failed to format Berlin timestamp');
  }

  return isoString;
}

export function getNextBerlinMidnight(input?: DateInput): Date {
  return toBerlinDateTime(input).plus({ days: 1 }).startOf('day').toJSDate();
}

export function getNextBerlinTime(
  hour: number,
  minute = 0,
  second = 0,
  input?: DateInput
): Date {
  const base = toBerlinDateTime(input);
  let target = base.set({
    hour,
    minute,
    second,
    millisecond: 0
  });

  if (target.toMillis() <= base.toMillis()) {
    target = target.plus({ days: 1 });
  }

  return target.toJSDate();
}

export function getBerlinHour(input?: DateInput): number {
  return toBerlinDateTime(input).hour;
}
