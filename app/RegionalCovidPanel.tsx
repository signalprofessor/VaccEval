'use client';

import { useState } from 'react';
import { Activity } from 'lucide-react';
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { addDays, dailySeries, summarizeRegion, type CareSetting, type RegionalCovid, type RegionalHealth } from './regional-covid-data';

const label = (date: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
const countLabel = (count: number | null) => count === null ? '—' : count.toLocaleString('en-GB');
const settings: Record<CareSetting, string> = { outpatient: 'Outpatient', inpatient: 'Inpatient', total: 'Total' };

export default function RegionalCovidPanel({ data, date, error, health }: { data: RegionalCovid | null; date: string; error: string | null; health: RegionalHealth | null }) {
  const [region, setRegion] = useState('Kalmar');
  const [setting, setSetting] = useState<CareSetting>('total');
  const [range, setRange] = useState('3m');
  const [expanded, setExpanded] = useState(false);
  const [assumeZeros, setAssumeZeros] = useState(true);
  const summary = data?.regions.map((region) => ({ region, ...summarizeRegion(data, region, date) })) ?? [];
  // Use the selected calendar date, so absent recent dates remain visible gaps.
  const start = data ? (range === 'all' ? data.meta.dateRange[0] : addDays(date, range === '1y' ? -365 : -90)) : date;
  const points = data && expanded ? dailySeries(data, region, setting, start, date, assumeZeros) : [];
  return (
    <section className="vaccination-panel regional-covid-panel">
      <div className="panel-title"><div><Activity size={18} /><span><strong>VaccEval COVID</strong><small>Health records from SÖSR · reporting completeness unknown</small></span></div></div>
      {!data ? <div className="panel-unavailable" role="status">{error || 'Loading protected regional data…'}</div> : <>
        {(health?.state === 'unavailable' || error) && <div className="source-warning" role="status"><div><strong>Previous validated regional data in use</strong><span>The latest refresh failed. Stored observations remain available.</span></div></div>}
        {health && Date.now() - Date.parse(health.checkedAt) > 2 * 86400000 && <div className="source-warning" role="status"><div><strong>Automatic check overdue</strong><span>No recorded source check in the last two days. Stored data remain visible.</span></div></div>}
        <div className="regional-table-scroll"><table className="regional-table"><thead><tr><th>Region / latest observation</th><th>Outpatient</th><th>Inpatient</th><th>Total</th></tr></thead><tbody>
          {summary.map((item) => <tr key={item.region}><th>{item.region}<small>{item.end ? label(item.end) : 'No prior observation'}</small><small>{item.observedDays}/7 days have records</small></th><td>{countLabel(item.outpatient)}</td><td>{countLabel(item.inpatient)}</td><td>{countLabel(item.total)}</td></tr>)}
        </tbody></table></div>
        <p className="qualification">Registered counts in the seven calendar days ending at each region’s latest observation on or before the selected date. Missing days are unknown, never zero. Totals add outpatient and inpatient diagnoses and may include the same person more than once. Periods differ between regions.</p>
        <div className="regional-data-note">Changes, alerts and forecasts are not assessed: completeness is unknown. Last observation does not establish a complete reporting period.</div>
        <button className="regional-expand" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide history and other measures' : 'Explore history and other measures'}</button>
        {expanded && <div className="regional-history">
          <div className="regional-filters"><label>Region<select value={region} onChange={(e) => setRegion(e.target.value)}>{data.regions.map((region) => <option key={region}>{region}</option>)}</select></label>
            <label>Care setting<select value={setting} onChange={(e) => setSetting(e.target.value as CareSetting)}>{Object.entries(settings).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
            <label>History<select value={range} onChange={(e) => setRange(e.target.value)}><option value="3m">3 months</option><option value="1y">1 year</option><option value="all">All history</option></select></label></div>
          <label className="missing-date-option">Missing dates within the observed period<select value={assumeZeros ? 'zero' : 'gap'} onChange={(event) => setAssumeZeros(event.target.value === 'zero')}><option value="zero">Show as 0 (assumption)</option><option value="gap">Show as gaps</option></select></label>
          <p className="qualification">{assumeZeros ? 'Missing dates between the first and last observation are plotted as assumed zeros; source values remain unchanged.' : 'Missing dates appear as gaps.'} Dates outside the observed period remain unavailable.</p>
          <div className="regional-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={points} margin={{ top: 16, right: 16, bottom: 8, left: 0 }}><CartesianGrid strokeDasharray="3 5" vertical={false} /><XAxis dataKey="date" minTickGap={40} tickFormatter={(value) => label(value).slice(0, 6)} tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} width={40} tick={{ fontSize: 10 }} /><Tooltip labelFormatter={(value) => label(String(value))} formatter={(value) => [value, `${settings[setting]} diagnoses`]} /><Line dataKey="count" name={settings[setting]} stroke="var(--blue)" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div>
          <div className="regional-extra"><strong>Separate source measures · {region}</strong>
            {[{ name: 'COVID care episodes', rows: data.encounters }, { name: 'COVID vaccinations in the preceding six months', rows: data.vaccinations }].map(({ name, rows }) => {
              const latest = rows.filter((row) => row.region === region && row.date <= date).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
              return <p key={name}>{name}: <b>{countLabel(latest?.count ?? null)}</b>{latest && <small> · {label(latest.date)}</small>}</p>;
            })}
            <p className="qualification">Care episodes are a separate measure and are not added to diagnoses. Vaccination counts reproduce the source’s rolling six-month measure; doses versus people is unconfirmed. This is not a coverage percentage and daily values must not be summed.</p>
          </div>
        </div>}
        <p className="qualification">Imported {label(data.meta.importedAt.slice(0, 10))}.{health ? ` Source checked ${label(health.checkedAt.slice(0, 10))}.` : ' Automatic refresh not yet verified.'} Source completeness remains unknown during historical replay.</p>
      </>}
    </section>
  );
}
