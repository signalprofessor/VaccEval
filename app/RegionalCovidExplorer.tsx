'use client';

import { useState } from 'react';
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import ExploreSourceSelect, { type ExploreMode } from './ExploreSourceSelect';
import { addDays, dailySeries, type CareSetting, type RegionalCovid, type RegionalHealth } from './regional-covid-data';

const labels: Record<CareSetting, string> = { inpatient: 'Admitted cases', outpatient: 'Policlinical cases', total: 'Total diagnosed cases' };
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

export default function RegionalCovidExplorer({ data, setting, onSourceChange, health, error }: {
  data: RegionalCovid | null; setting: CareSetting; onSourceChange: (mode: ExploreMode) => void;
  health: RegionalHealth | null; error: string | null;
}) {
  const [region, setRegion] = useState('Östergötland');
  const [cutoff, setCutoff] = useState<string | null>(null);
  const [range, setRange] = useState('3m');
  const [selection, setSelection] = useState('COVID-19');
  const maxDate = data?.meta.dateRange[1] || new Date().toISOString().slice(0, 10);
  const date = cutoff || maxDate;
  const start = data ? range === 'all' ? data.meta.dateRange[0] : addDays(date, range === '1y' ? -365 : range === '6m' ? -182 : -90) : date;
  const rows = data?.diagnoses.filter((row) => row.region === region && row.date <= date) ?? [];
  const latest = rows.at(-1);
  const points = data ? dailySeries(data, region, setting, start, date) : [];
  const week = rows.filter((row) => row.date >= addDays(date, -6));
  const registered = week.length ? week.reduce((sum, row) => sum + row[setting], 0) : null;
  return <section className="workspace explore-workspace">
    <div className="filterbar seven">
      <ExploreSourceSelect value={setting} onChange={onSourceChange} />
      <label>Region<select value={region} onChange={(event) => setRegion(event.target.value)}>{(data?.regions || ['Östergötland', 'Jönköping', 'Kalmar']).map((region) => <option key={region}>{region}</option>)}</select></label>
      <label>Pathogen<select value={selection} onChange={(event) => setSelection(event.target.value)}><option>COVID-19</option></select></label>
      <label>Age<select disabled><option>All ages</option></select></label>
      <label>Sex<select disabled><option>All sexes</option></select></label>
      <label>Model<select disabled><option>Not assessed (missing data)</option></select></label>
      <label>Plot range<select value={range} onChange={(event) => setRange(event.target.value)}><option value="3m">3 months</option><option value="6m">6 months</option><option value="1y">1 year</option><option value="all">All history</option></select></label>
      <div className="date-control"><span>Historical replay</span><div><input aria-label="Historical replay date" type="date" value={date} min={data?.meta.dateRange[0]} max={maxDate} onChange={(event) => { if (event.target.value) setCutoff(event.target.value); }} /></div></div>
    </div>
    {!data ? <div className="panel-unavailable">{error || 'Loading protected VaccEval COVID data…'}</div> : <>
      {(health?.state === 'unavailable' || error) && <div className="source-warning" role="status"><strong>Source refresh unavailable · previous validated data retained</strong></div>}
      <div className="metrics">
        <article><span>Latest daily level</span><strong>{latest ? latest[setting].toLocaleString('en-GB') : '—'}</strong><small>cases · {latest ? dateLabel(latest.date) : 'No prior observation'}</small></article>
        <article><span>Registered in selected 7 days</span><strong>{registered === null ? '—' : registered.toLocaleString('en-GB')}</strong><small>{week.length}/7 days have records · incomplete totals</small></article>
        <article><span>Change</span><strong>N/A</strong><small>Missing dates are unknown, not zero</small></article>
        <article><span>Alert</span><strong>Not assessed</strong><small>Reporting completeness unknown</small></article>
        <article><span>Forecast</span><strong>Not assessed</strong><small>Reporting completeness unknown</small></article>
      </div>
      <article className="chart-card">
        <div className="card-head"><div><h2>COVID-19 · {labels[setting]} · {region}</h2><p>Health records from SÖSR · VaccEval via LiU · daily registered cases</p></div></div>
        <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={points} margin={{ top: 18, right: 20, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#dbe5e2" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="date" minTickGap={38} tickFormatter={(value) => dateLabel(value).slice(0, 6)} tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip labelFormatter={(value) => dateLabel(String(value))} formatter={(value) => [value, 'Cases']} /><Line dataKey="count" name="Cases" stroke="#123f3a" strokeWidth={2} dot={{ r: 2.5 }} connectNulls={false} isAnimationActive={false} /><ReferenceLine x={date} stroke="#78908b" strokeDasharray="4 4" />
        </ComposedChart></ResponsiveContainer></div>
        <p className="qualification">Missing dates remain gaps, including after the latest observation. An explicit zero is shown as zero. These are registered diagnosis counts, not unique patients. Total diagnosed cases adds inpatient and outpatient records. Latest observation does not confirm complete reporting.</p>
      </article>
    </>}
  </section>;
}
