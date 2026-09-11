const RELEASE_DATES_2026 = [
  '2026-09-11','2026-09-12','2026-09-13','2026-09-14',
  '2026-09-18','2026-09-19','2026-09-20','2026-09-21',
  '2026-09-25','2026-09-26','2026-09-27','2026-09-28',
  '2026-10-02','2026-10-03','2026-10-04','2026-10-05',
  '2026-10-09','2026-10-10','2026-10-11','2026-10-12',
  '2026-10-17','2026-10-18'
];

export const GAULEY_FEST_DATES = ['2026-09-17','2026-09-18','2026-09-19','2026-09-20'];

export function localDateParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const p = Object.fromEntries(fmt.formatToParts(now).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

export function isIsoOnLocalDate(iso, date) {
  if (!iso || !date) return false;
  const instant = new Date(iso);
  if (!Number.isFinite(instant.getTime())) return false;
  return localDateParts(instant).date === date;
}

export function isReleaseDate(date) { return RELEASE_DATES_2026.includes(date); }
export function isFestDate(date) { return GAULEY_FEST_DATES.includes(date); }
export function releaseDates2026() { return [...RELEASE_DATES_2026]; }

export function nextRelease(date) {
  return RELEASE_DATES_2026.find(d => d > date) || null;
}

export function nthDowOfMonth(year, monthIndex, dow, nth) {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const shift = (dow - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, monthIndex, 1 + shift + (nth - 1) * 7));
}

export function laborDay(year) { return nthDowOfMonth(year, 8, 1, 1); }

export function modeledReleaseDatesForYear(year) {
  const ld = laborDay(year);
  const fridayAfter = new Date(ld);
  fridayAfter.setUTCDate(ld.getUTCDate() + 4);
  const out = [];
  for (let weekend = 0; weekend < 5; weekend++) {
    for (let offset = 0; offset < 4; offset++) {
      const d = new Date(fridayAfter);
      d.setUTCDate(fridayAfter.getUTCDate() + weekend * 7 + offset);
      out.push(d.toISOString().slice(0, 10));
    }
  }
  const lastSat = new Date(fridayAfter);
  lastSat.setUTCDate(fridayAfter.getUTCDate() + 5 * 7 + 1);
  out.push(lastSat.toISOString().slice(0, 10));
  const lastSun = new Date(lastSat); lastSun.setUTCDate(lastSat.getUTCDate() + 1);
  out.push(lastSun.toISOString().slice(0, 10));
  return out;
}
