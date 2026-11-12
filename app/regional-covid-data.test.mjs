import assert from 'node:assert/strict';
import { dailySeries, summarizeRegion } from './regional-covid-data.ts';

const data = {
  meta: { importedAt: '2026-11-12', dateRange: ['2026-10-01', '2026-10-03'], reportingCompleteness: 'unknown' },
  regions: ['Kalmar'], encounters: [], vaccinations: [],
  diagnoses: [
    { date: '2026-10-01', region: 'Kalmar', outpatient: 0, inpatient: 1, total: 1 },
    { date: '2026-10-03', region: 'Kalmar', outpatient: 2, inpatient: 3, total: 5 },
  ],
};
assert.deepEqual(dailySeries(data, 'Kalmar', 'outpatient', '2026-10-01', '2026-10-04').map((p) => p.count), [0, null, 2, null]);
assert.deepEqual(dailySeries(data, 'Kalmar', 'outpatient', '2026-09-30', '2026-10-04', true).map((p) => p.count), [null, 0, 0, 2, null]);
assert.equal(dailySeries(data, 'Kalmar', 'outpatient', '2026-10-01', '2026-10-03', true)[1].assumedZero, true);
assert.equal(dailySeries(data, 'Kalmar', 'outpatient', '2026-10-01', '2026-10-03', true)[0].assumedZero, false);
assert.deepEqual(dailySeries(data, 'Kalmar', 'outpatient', '2026-10-01', '2026-10-02', true).map((p) => p.count), [0, null]);
const summary = summarizeRegion(data, 'Kalmar', '2026-10-03');
assert.equal(summary.total, 6);
assert.equal(summary.outpatient + summary.inpatient, summary.total);
assert.equal(summary.observedDays, 2);
assert.equal(summarizeRegion(data, 'Kalmar', '2026-09-30').total, null);
assert.equal(summarizeRegion(data, 'Kalmar', '2026-10-01').total, 1);
assert.equal(summarizeRegion(data, 'Jönköping', '2026-10-03').total, null);
console.log('Regional summaries, historical cutoff, explicit zero and missing-date gaps verified.');
