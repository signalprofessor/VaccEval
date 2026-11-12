export type CareSetting = 'outpatient' | 'inpatient' | 'total';
export type Diagnosis = { date: string; region: string; outpatient: number; inpatient: number; total: number };
export type RegionalCovid = {
  meta: { importedAt: string; dateRange: string[]; reportingCompleteness: 'unknown' };
  regions: string[];
  diagnoses: Diagnosis[];
  encounters: { date: string; region: string; count: number }[];
  vaccinations: { date: string; region: string; count: number }[];
};

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function summarizeRegion(data: RegionalCovid, region: string, cutoff: string) {
  const rows = data.diagnoses.filter((row) => row.region === region && row.date <= cutoff);
  const end = rows.map((row) => row.date).sort().at(-1) ?? null;
  const week = end ? rows.filter((row) => row.date >= addDays(end, -6)) : [];
  const count = (setting: CareSetting) => week.length ? week.reduce((sum, row) => sum + row[setting], 0) : null;
  return { end, observedDays: new Set(week.map((row) => row.date)).size, outpatient: count('outpatient'), inpatient: count('inpatient'), total: count('total') };
}

export function dailySeries(data: RegionalCovid, region: string, setting: CareSetting, start: string, end: string) {
  const rows = new Map(data.diagnoses.filter((row) => row.region === region).map((row) => [row.date, row]));
  const points: { date: string; count: number | null }[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    points.push({ date, count: rows.get(date)?.[setting] ?? null });
  }
  return points;
}
