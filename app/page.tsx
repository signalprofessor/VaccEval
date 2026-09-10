'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, CalendarDays, ChevronLeft, ChevronRight, ShieldCheck, TrendingUp } from 'lucide-react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type Datum = { date: string; region: string; pathogen: string; count: number };
type Dataset = { meta: { sourceSnapshot: string; generatedAt: string; dateRange: string[]; measure: string; privacy: string }; regions: string[]; pathogens: string[]; series: Datum[] };

const fmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });

function mean(values: number[]) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function clamp(value: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, value)); }
function dateLabel(value: string) { return fmt.format(new Date(`${value}T12:00:00`)); }

export default function Home() {
  const [data, setData] = useState<Dataset | null>(null);
  const [region, setRegion] = useState('Östergötland');
  const [pathogen, setPathogen] = useState('Influenza');
  const [analysisDate, setAnalysisDate] = useState('2025-02-15');

  useEffect(() => { fetch('/data/vacceval.json').then(r => r.json()).then(setData); }, []);

  const result = useMemo(() => {
    if (!data) return null;
    const base = data.series.filter(d => d.region === region && d.pathogen === pathogen);
    const index = clamp(base.findIndex(d => d.date >= analysisDate), 13, base.length - 15);
    const chosen = base[index]?.date === analysisDate ? index : Math.max(13, index - 1);
    const smooth = base.map((d, i) => ({ ...d, smooth: mean(base.slice(Math.max(0, i - 6), i + 1).map(x => x.count)) }));
    const current = mean(base.slice(chosen - 6, chosen + 1).map(d => d.count));
    const previous = mean(base.slice(chosen - 13, chosen - 6).map(d => d.count));
    const slope = (current - previous) / 7;
    const relChange = (current - previous) / Math.max(previous, 1);
    const residuals = [...base.slice(chosen - 13, chosen - 6).map(d => d.count - previous), ...base.slice(chosen - 6, chosen + 1).map(d => d.count - current)];
    const sigma = Math.max(1, Math.sqrt(mean(residuals.map(x => x * x))));
    const start = Math.max(0, chosen - 83);
    const observed = smooth.slice(start, chosen + 1).map(d => ({ ...d, observed: d.count }));
    const predictions = Array.from({ length: 14 }, (_, offset) => {
      const h = offset + 1;
      const pred = Math.max(0, current + slope * h);
      const width = 1.96 * sigma * Math.sqrt(1 + h / 14);
      const dt = new Date(`${base[chosen].date}T12:00:00`); dt.setDate(dt.getDate() + h);
      return { date: dt.toISOString().slice(0, 10), prediction: pred, bandLow: Math.max(0, pred - width), bandHigh: pred + width, bandRange: [Math.max(0, pred - width), pred + width] };
    });
    const btErrors: number[] = [];
    for (let i = Math.max(14, chosen - 90); i <= chosen - 7; i++) {
      const cur = mean(base.slice(i - 6, i + 1).map(d => d.count));
      const prev = mean(base.slice(i - 13, i - 6).map(d => d.count));
      const predicted = Math.max(0, cur + (cur - prev));
      btErrors.push(Math.abs(smooth[i + 7].smooth - predicted));
    }
    const mae = mean(btErrors);
    const scale = Math.max(1, mean(smooth.slice(Math.max(21, chosen - 83), chosen + 1).map(d => d.smooth)));
    const nmae = mae / scale;
    const reliabilityScore = clamp(1 - (nmae - .2) / .4, 0, 1);
    const alert = relChange > .5 ? 'Red' : relChange > .2 ? 'Yellow' : 'Green';
    return { chart: [...observed, ...predictions], current, previous, slope, relChange, mae, nmae, reliabilityScore, alert, date: base[chosen].date, maxDate: base[base.length - 15].date };
  }, [data, region, pathogen, analysisDate]);

  function moveDate(days: number) {
    if (!result || !data) return;
    const dt = new Date(`${result.date}T12:00:00`); dt.setDate(dt.getDate() + days);
    const next = dt.toISOString().slice(0, 10);
    setAnalysisDate(next < data.meta.dateRange[0] ? data.meta.dateRange[0] : next > result.maxDate ? result.maxDate : next);
  }

  if (!data || !result) return <main className="loading">Loading VaccEval surveillance data…</main>;
  const trendWord = Math.abs(result.relChange) < .1 ? 'Stable' : result.relChange > 0 ? 'Increasing' : 'Decreasing';
  const reliabilityWord = result.reliabilityScore >= .67 ? 'High' : result.reliabilityScore >= .33 ? 'Moderate' : 'Low';

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Activity size={19}/></span><div><strong>VaccEval</strong><span>Infectious disease surveillance</span></div></div>
      <div className="status"><span></span> Data snapshot {data.meta.sourceSnapshot}</div>
      <button className="method">Methodology</button>
    </header>

    <section className="workspace">
      <div className="heading-row"><div><p className="eyebrow">Situational overview</p><h1>{pathogen} in {region}</h1><p>Observed healthcare encounters, causal trend and a transparent 14-day outlook.</p></div><div className="snapshot"><CalendarDays size={17}/><span>Analysis date<strong>{dateLabel(result.date)}</strong></span></div></div>

      <div className="filterbar">
        <label>Region<select value={region} onChange={e => setRegion(e.target.value)}>{data.regions.map(x => <option key={x}>{x}</option>)}</select></label>
        <label>Pathogen<select value={pathogen} onChange={e => setPathogen(e.target.value)}>{data.pathogens.map(x => <option key={x}>{x}</option>)}</select></label>
        <div className="date-control"><span>Historical replay</span><div><button aria-label="Previous week" onClick={() => moveDate(-7)}><ChevronLeft size={17}/></button><input type="date" value={result.date} min={data.meta.dateRange[0]} max={result.maxDate} onChange={e => setAnalysisDate(e.target.value)}/><button aria-label="Next week" onClick={() => moveDate(7)}><ChevronRight size={17}/></button></div></div>
        <label>Model<select disabled><option>Week-over-week</option></select></label>
      </div>

      <div className="metrics">
        <article><span>Current level</span><strong>{result.current.toFixed(1)}</strong><small>encounters per day</small></article>
        <article><span>Weekly change</span><strong className={result.relChange >= 0 ? 'up' : 'down'}>{result.relChange >= 0 ? '+' : ''}{(result.relChange * 100).toFixed(0)}%</strong><small>versus previous week</small></article>
        <article><span>Trend</span><strong>{trendWord}</strong><small>{Math.abs(result.slope).toFixed(2)} encounters/day²</small></article>
        <article><span>Alert</span><strong className={`alert ${result.alert.toLowerCase()}`}><i></i>{result.alert}</strong><small>20% / 50% thresholds</small></article>
        <article><span>Forecast reliability</span><strong>{reliabilityWord}</strong><small>{(result.reliabilityScore * 100).toFixed(0)}% score · NMAE {(result.nmae * 100).toFixed(0)}%</small></article>
      </div>

      <div className="content-grid">
        <article className="chart-card"><div className="card-head"><div><h2>Activity and short-term forecast</h2><p>Real-time view uses only observations available on the analysis date.</p></div><div className="legend"><span className="dot observed"></span>Daily encounters <span className="line smooth"></span>7-day mean <span className="line forecast"></span>Forecast</div></div>
          <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={result.chart} margin={{top:18,right:20,bottom:4,left:-12}}><CartesianGrid stroke="#dbe5e2" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="date" tickFormatter={v => shortFmt.format(new Date(`${v}T12:00:00`))} minTickGap={38} tick={{fontSize:11,fill:'#62716e'}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:11,fill:'#62716e'}} axisLine={false} tickLine={false}/><Tooltip labelFormatter={dateLabel} contentStyle={{borderRadius:10,border:'1px solid #dbe5e2'}}/><Area dataKey="bandRange" stroke="none" fill="#a6c9c3" fillOpacity={.28}/><Line dataKey="observed" stroke="#a9b6b3" strokeWidth={0} dot={{r:2.3,fill:'#768581',stroke:'none'}} isAnimationActive={false}/><Line dataKey="smooth" stroke="#123f3a" strokeWidth={2.6} dot={false} connectNulls isAnimationActive={false}/><Line dataKey="prediction" stroke="#d16f3f" strokeWidth={2.8} strokeDasharray="7 5" dot={false} connectNulls isAnimationActive={false}/><ReferenceLine x={result.date} stroke="#8d9a97" strokeDasharray="3 4" label={{value:'Analysis date',position:'insideTopLeft',fill:'#62716e',fontSize:11}}/></ComposedChart></ResponsiveContainer></div>
        </article>
        <aside className="insight-card"><div className="insight-icon"><TrendingUp size={19}/></div><p className="eyebrow">Model interpretation</p><h2>The last week was {Math.abs(result.relChange * 100).toFixed(0)}% {result.relChange >= 0 ? 'higher' : 'lower'} than the week before.</h2><p>The week-over-week model compares two complete seven-day periods, reducing sensitivity to weekday reporting patterns.</p><div className="reliability"><div><ShieldCheck size={18}/><span>Historical reliability<strong>{reliabilityWord}</strong></span></div><div className="meter"><i style={{width:`${result.reliabilityScore * 100}%`}}></i></div><small>Mean absolute error: {result.mae.toFixed(1)} encounters</small></div></aside>
      </div>
      <footer><span>Aggregate data only · No personal identifiers included</span><span>{data.meta.dateRange[0]} — {data.meta.dateRange[1]}</span></footer>
    </section>
  </main>;
}
