'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Database,
  HeartPulse,
  LayoutDashboard,
  ShieldCheck,
  SlidersHorizontal,
  Syringe,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type ClinicalDatum = {
  date: string;
  region: string;
  pathogen: string;
  count: number;
};
type WWDatum = {
  date: string;
  region: string;
  pathogen: string;
  value: number;
};
type ClinicalData = {
  meta: {
    sourceSnapshot: string;
    dateRange: string[];
    regionDateRanges?: Record<string, string[]>;
  };
  regions: string[];
  pathogens: string[];
  series: ClinicalDatum[];
};
type WWData = {
  meta: { dateRange: string[]; generatedAt: string; methodChangeDate: string };
  regions: string[];
  pathogens: string[];
  series: WWDatum[];
};
type VaccinationRecord = {
  region: string;
  ageGroup: string;
  count: number;
  percent: number;
};
type VaccinationData = {
  meta: { generatedAt: string; scope: string };
  snapshots: {
    snapshotDate: string;
    sourceUpdatedAt: string;
    records: VaccinationRecord[];
  }[];
};
type MortalityDatum = {
  week: string;
  date: string;
  region: string;
  count: number;
};
type MortalityData = {
  meta: { dateRange: string[]; sourceUpdatedAt: string; status: string };
  series: MortalityDatum[];
};
type CaseDatum = {
  week: string;
  date: string;
  region: string;
  pathogen: string;
  count: number;
  per100k: number;
};
type CaseData = {
  meta: { dateRange: string[]; sourceUpdatedAt: string; qualification: string };
  regions: string[];
  pathogens: string[];
  series: CaseDatum[];
};
type Point = { date: string; value: number };
type Mode = 'clinical' | 'wastewater' | 'cases';
type Model = 'weekoverweek' | 'linear';
type ViewMode = 'monitor' | 'explore';
type PlotRange = '3m' | '6m' | '1y' | 'all';

const fmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const shortFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
});
const numberFmt = new Intl.NumberFormat('en-GB');
const mean = (v: number[]) =>
  v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
const clamp = (v: number, l: number, h: number) => Math.max(l, Math.min(h, v));
const dateLabel = (v: string) => fmt.format(new Date(`${v}T12:00:00`));
const shift = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00`);
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
};
const ageDays = (d: string) =>
  Math.floor((Date.now() - new Date(`${d}T12:00:00`).getTime()) / 86400000);

function withCaseAggregates(cases: CaseData): CaseData {
  const canonical = ['COVID-19', 'Influenza A+B', 'RSV'],
    dates = [...new Set(cases.series.map((d) => d.date))],
    additions: CaseDatum[] = [];
  const combine = (
    rows: CaseDatum[],
    date: string,
    region: string,
    pathogen: string,
  ) => {
    if (!rows.length) return;
    const count = rows.reduce((sum, row) => sum + row.count, 0),
      populations = new Map<string, number>();
    for (const row of rows) if (row.per100k > 0 && !populations.has(row.region)) populations.set(row.region, (row.count / row.per100k) * 100000);
    const population = [...populations.values()].reduce((sum, value) => sum + value, 0);
    additions.push({
      week: rows[0].week,
      date,
      region,
      pathogen,
      count,
      per100k: population > 0 ? (count / population) * 100000 : 0,
    });
  };
  for (const date of dates) {
    for (const pathogen of cases.pathogens)
      combine(
        cases.series.filter((d) => d.date === date && d.pathogen === pathogen),
        date,
        'All regions',
        pathogen,
      );
    for (const region of cases.regions)
      combine(
        cases.series.filter(
          (d) =>
            d.date === date &&
            d.region === region &&
            canonical.includes(d.pathogen),
        ),
        date,
        region,
        'All viruses',
      );
    combine(
      cases.series.filter(
        (d) => d.date === date && canonical.includes(d.pathogen),
      ),
      date,
      'All regions',
      'All viruses',
    );
  }
  return {
    ...cases,
    regions: ['All regions', ...cases.regions],
    pathogens: ['All viruses', ...cases.pathogens],
    series: [...cases.series, ...additions],
  };
}

function analyse(
  base: Point[],
  requested: string,
  mode: Mode,
  model: Model,
  plotRange: PlotRange,
) {
  const reserve = mode === 'clinical' ? 14 : mode === 'wastewater' ? 2 : 0;
  let found = base.findIndex((d) => d.date >= requested);
  const target =
    found < 0
      ? base.length - 1
      : base[found]?.date === requested
        ? found
        : found - 1;
  const chosen = clamp(
    target,
    mode === 'clinical' ? 13 : 1,
    base.length - reserve - 1,
  );
  const smooth = base.map((d, i) => ({
    ...d,
    smooth: mean(
      base
        .slice(Math.max(0, i - (mode === 'clinical' ? 6 : 1)), i + 1)
        .map((x) => x.value),
    ),
  }));
  let current = 0,
    previous = 0,
    slope = 0,
    relChange = 0,
    relativeChangeAvailable = true,
    sigma = 1,
    predictions: any[] = [];
  if (mode !== 'clinical') {
    current = smooth[chosen].smooth;
    previous = smooth[chosen - 1].smooth;
    slope = current - previous;
    const recentScale = mean(
      smooth
        .slice(Math.max(0, chosen - 12), chosen + 1)
        .map((d) => Math.abs(d.smooth)),
    );
    const baselineFloor = Math.max(Number.EPSILON, recentScale * 0.01);
    relativeChangeAvailable = Math.abs(previous) >= baselineFloor;
    relChange = relativeChangeAvailable
      ? (current - previous) / Math.abs(previous)
      : 0;
    const diffs = smooth
      .slice(Math.max(1, chosen - 8), chosen + 1)
      .map((d, i, a) => (i ? d.smooth - a[i - 1].smooth : NaN))
      .filter(Number.isFinite);
    sigma = Math.max(Number.EPSILON, Math.sqrt(mean(diffs.map((x) => x * x))));
    predictions = [1, 2].map((h) => {
      const pred = Math.max(0, current + slope * h),
        w = 1.96 * sigma * Math.sqrt(h);
      return {
        date: shift(base[chosen].date, h * 7),
        prediction: pred,
        bandRange: [Math.max(0, pred - w), pred + w],
      };
    });
  } else {
    const currentWeek = mean(
      base.slice(chosen - 6, chosen + 1).map((d) => d.value),
    );
    previous = mean(base.slice(chosen - 13, chosen - 6).map((d) => d.value));
    const fit = smooth.slice(chosen - 13, chosen + 1),
      xm = 6.5,
      ym = mean(fit.map((d) => d.smooth));
    const ls =
        fit.reduce((s, d, i) => s + (i - xm) * (d.smooth - ym), 0) /
        fit.reduce((s, _d, i) => s + (i - xm) ** 2, 0),
      ll = ym + ls * (13 - xm);
    current = model === 'linear' ? Math.max(0, ll) : currentWeek;
    slope = model === 'linear' ? ls : (currentWeek - previous) / 7;
    relChange =
      model === 'linear'
        ? (slope * 7) / Math.max(current, 1)
        : (currentWeek - previous) / Math.max(previous, 1);
    const res =
      model === 'linear'
        ? fit.map((d, i) => d.smooth - (ll + ls * (i - 13)))
        : [
            ...base
              .slice(chosen - 13, chosen - 6)
              .map((d) => d.value - previous),
            ...base
              .slice(chosen - 6, chosen + 1)
              .map((d) => d.value - currentWeek),
          ];
    sigma = Math.max(1, Math.sqrt(mean(res.map((x) => x * x))));
    predictions = Array.from({ length: 14 }, (_, o) => {
      const h = o + 1,
        p = Math.max(0, current + slope * h),
        w = 1.96 * sigma * Math.sqrt(1 + h / 14);
      return {
        date: shift(base[chosen].date, h),
        prediction: p,
        bandRange: [Math.max(0, p - w), p + w],
      };
    });
  }
  const ranges = {
      clinical: {
        '3m': 90,
        '6m': 182,
        '1y': 365,
        all: Number.MAX_SAFE_INTEGER,
      },
      weekly: { '3m': 13, '6m': 26, '1y': 52, all: Number.MAX_SAFE_INTEGER },
    } as const,
    lookback =
      mode === 'clinical'
        ? ranges.clinical[plotRange]
        : ranges.weekly[plotRange],
    start = Math.max(0, chosen - lookback);
  const observed = smooth
    .slice(start, chosen + 1)
    .map((d) => ({ ...d, observed: d.value }));
  const errors: number[] = [];
  const horizon = mode === 'clinical' ? 7 : 1;
  for (
    let i = Math.max(
      mode === 'clinical' ? 14 : 2,
      chosen - (mode === 'clinical' ? 90 : 26),
    );
    i <= chosen - horizon;
    i++
  ) {
    if (mode !== 'clinical') {
      const p = Math.max(
        0,
        smooth[i].smooth + (smooth[i].smooth - smooth[i - 1].smooth),
      );
      errors.push(Math.abs(smooth[i + 1].smooth - p));
    } else {
      const cur = mean(base.slice(i - 6, i + 1).map((d) => d.value)),
        prev = mean(base.slice(i - 13, i - 6).map((d) => d.value));
      const lf = smooth.slice(i - 13, i + 1),
        lm = mean(lf.map((d) => d.smooth));
      const ls =
          lf.reduce((s, d, j) => s + (j - 6.5) * (d.smooth - lm), 0) /
          lf.reduce((s, _d, j) => s + (j - 6.5) ** 2, 0),
        ll = lm + ls * 6.5;
      const p =
        model === 'linear'
          ? Math.max(0, ll + ls * 7)
          : Math.max(0, cur + (cur - prev));
      errors.push(Math.abs(smooth[i + 7].smooth - p));
    }
  }
  const mae = mean(errors),
    scale = Math.max(
      Number.EPSILON,
      mean(smooth.slice(start, chosen + 1).map((d) => Math.abs(d.smooth))),
    ),
    nmae = mae / scale,
    reliability = clamp(1 - (nmae - 0.2) / 0.4, 0, 1),
    alert = relativeChangeAvailable
      ? relChange > 0.5
        ? 'Red'
        : relChange > 0.2
          ? 'Yellow'
          : 'Green'
      : 'Not assessed';
  return {
    chart: [...observed, ...predictions],
    current,
    previous,
    slope,
    relChange,
    relativeChangeAvailable,
    mae,
    nmae,
    reliability,
    alert,
    date: base[chosen].date,
    maxDate: base[base.length - reserve - 1].date,
  };
}

function MonitorView({
  clinical,
  ww,
  cases,
  vaccination,
  mortality,
}: {
  clinical: ClinicalData;
  ww: WWData;
  cases: CaseData;
  vaccination: VaccinationData;
  mortality: MortalityData;
}) {
  const monitorMin = [
      cases.meta.dateRange[0],
      ww.meta.dateRange[0],
      mortality.meta.dateRange[0],
      clinical.meta.dateRange[0],
    ].sort().at(-1)!,
    monitorMax = [
      cases.meta.dateRange[1],
      ww.meta.dateRange[1],
      mortality.meta.dateRange[1],
      vaccination.snapshots.at(-1)!.snapshotDate,
    ].sort().at(-1)!,
    [monitorDate, setMonitorDate] = useState(monitorMax);
  const virusOverview = clinical.regions
    .filter((r) => r !== 'All regions')
    .map((region) => {
      const end =
          clinical.series
            .filter((d) => d.region === region && d.date <= monitorDate)
            .map((d) => d.date)
            .sort()
            .at(-1) || clinical.meta.regionDateRanges?.[region]?.[0] || clinical.meta.dateRange[0],
        weekStart = shift(end, -6),
        previousStart = shift(end, -13),
        previousEnd = shift(end, -7);
      return {
        region,
        end,
        viruses: clinical.pathogens.map((pathogen) => {
          const rows = clinical.series.filter(
              (d) => d.region === region && d.pathogen === pathogen,
            ),
            count = rows
              .filter((d) => d.date >= weekStart && d.date <= end)
              .reduce((sum, d) => sum + d.count, 0),
            previous = rows
              .filter((d) => d.date >= previousStart && d.date <= previousEnd)
              .reduce((sum, d) => sum + d.count, 0),
            change =
              previous >= 10 && count >= 10
                ? (count - previous) / previous
                : null;
          return { pathogen, count, change };
        }),
      };
    });
  const clinicalEnd = clinical.series.filter((d) => d.date <= monitorDate).map((d) => d.date).sort().at(-1) || clinical.meta.dateRange[0];
  const vaccine = vaccination.snapshots.filter((d) => d.snapshotDate <= monitorDate).at(-1);
  const maxCoverage = vaccine ? Math.max(...vaccine.records.map((r) => r.percent), 1) : 1;
  const mortalityLatest = mortality.series.filter((d) => d.date <= monitorDate).map((d) => d.date).sort().at(-1) || mortality.meta.dateRange[0];
  const mortalityCards = mortality.series
    .filter((d) => d.date === mortalityLatest)
    .map((latest) => {
      const history = mortality.series.filter(
        (d) => d.region === latest.region && d.date < mortalityLatest,
      );
      const previous = history.at(-1);
      return {
        ...latest,
        change:
          previous && previous.count
            ? ((latest.count - previous.count) / previous.count) * 100
            : null,
      };
    });
  const caseLatest = cases.series.filter((d) => d.date <= monitorDate).map((d) => d.date).sort().at(-1) || cases.meta.dateRange[0];
  const wwLatest = ww.series.filter((d) => d.date <= monitorDate).map((d) => d.date).sort().at(-1) || ww.meta.dateRange[0];
  const caseOverview = cases.regions.map((region) => ({
    region,
    viruses: cases.pathogens.map((pathogen) => {
      const current = cases.series.find(
        (d) =>
          d.region === region &&
          d.pathogen === pathogen &&
          d.date === caseLatest,
      );
      return {
        pathogen,
        count: current?.count ?? null,
        per100k: current?.per100k ?? null,
      };
    }),
  }));
  const clinicalLag = Math.floor((new Date(`${monitorDate}T12:00:00`).getTime() - new Date(`${clinicalEnd}T12:00:00`).getTime()) / 86400000),
    clinicalAlerts = clinicalLag <= 7 ? virusOverview.flatMap((group) => group.viruses.filter((item) => item.change !== null && item.change > 0.2).map((item) => ({...item,region:group.region}))).sort((a,b)=>(b.change||0)-(a.change||0)) : [];
  const sources = [
    {
      name: 'Reported cases',
      date: caseLatest,
      state:
        monitorDate === monitorMax && ageDays(caseLatest) <= 21
          ? 'Current'
          : 'Historical',
      note: 'FHM / SmiNet',
    },
    {
      name: 'Wastewater',
      date: wwLatest,
      state: monitorDate === monitorMax && ageDays(wwLatest) <= 21 ? 'Current' : 'Historical',
      note: 'SLU / SEEC',
    },
    {
      name: 'Vaccination',
      date: vaccine?.snapshotDate || null,
      state: vaccine ? (ageDays(vaccine.snapshotDate) > 90 ? 'Seasonal pause' : 'Current') : 'Not available',
      note: 'FHM / NVR',
    },
    {
      name: 'Mortality',
      date: mortalityLatest,
      state: 'Preliminary',
      note: 'SCB',
    },
    {
      name: 'Clinical research',
      date: clinicalEnd,
      state: 'Snapshot',
      note: 'Three-region dataset',
    },
  ];
  return (
    <section className="monitor-workspace">
      <div className="monitor-replay">
        <label>
          Historical monitor date
          <input type="date" min={monitorMin} max={monitorMax} value={monitorDate} onChange={(event) => setMonitorDate(event.target.value)} />
        </label>
        <span>Each panel uses the latest observation available on or before this date.</span>
      </div>
      <div className="monitor-layout">
        <div className="monitor-main">
          <section className="virus-panel">
            <div className="panel-title">
              <div>
                <Activity size={18} />
                <span>
                  <strong>Virus activity overview</strong>
                  <small>
                    Reported cases and healthcare encounters · aggregate weekly
                    indicators
                  </small>
                </span>
              </div>
            </div>
            <div className="matrix-section">
              <div className="matrix-label">
                <strong>Laboratory-confirmed reported cases</strong>
                <small>per 100,000 · week ending {dateLabel(caseLatest)}</small>
              </div>
              <div className="clinical-matrix">
                <div className="matrix-head">
                  <span>Virus</span>
                  {caseOverview.map((group) => (
                    <span key={group.region}>
                      <strong>{group.region}</strong>
                      <small>rate · cases</small>
                    </span>
                  ))}
                </div>
                {cases.pathogens.map((pathogen) => (
                  <div className="matrix-row" key={pathogen}>
                    <strong>{pathogen}</strong>
                    {caseOverview.map((group) => {
                      const item = group.viruses.find(
                        (v) => v.pathogen === pathogen,
                      )!;
                      return (
                        <span key={group.region}>
                          <b>
                            {item.per100k === null
                              ? '—'
                              : item.per100k.toFixed(1)}
                          </b>
                          <small className="case-count">
                            {item.count === null
                              ? 'N/A'
                              : numberFmt.format(item.count)}
                          </small>
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div className="matrix-section clinical-section">
              <div className="matrix-label">
                <strong>Healthcare encounters</strong>
                <small>latest complete seven-day period per region</small>
              </div>
              <div className="clinical-matrix">
                <div className="matrix-head">
                  <span>Indicator</span>
                  {virusOverview.map((group) => (
                    <span key={group.region}>
                      <strong>{group.region}</strong>
                      <small>
                        to {shortFmt.format(new Date(`${group.end}T12:00:00`))}
                      </small>
                    </span>
                  ))}
                </div>
                {clinical.pathogens.map((pathogen) => (
                  <div className="matrix-row" key={pathogen}>
                    <strong>{pathogen}</strong>
                    {virusOverview.map((group) => {
                      const item = group.viruses.find(
                        (v) => v.pathogen === pathogen,
                      )!;
                      return (
                        <span key={group.region}>
                          <b>{numberFmt.format(item.count)}</b>
                          <small
                            className={
                              item.change === null
                                ? 'not-assessed'
                                : item.change > 0.5
                                  ? 'red'
                                  : item.change > 0.2
                                    ? 'yellow'
                                    : 'green'
                            }
                          >
                            {item.change === null
                              ? 'N/A'
                              : `${item.change >= 0 ? '+' : ''}${(item.change * 100).toFixed(0)}%`}
                          </small>
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </section>
          <section className={`warning-panel ${clinicalLag > 7 ? 'paused' : ''}`}>
            <div className="panel-title">
              <div>
                <AlertTriangle size={18} />
                <span>
                  <strong>Signals requiring attention</strong>
                  <small>{clinicalLag > 7 ? 'Changes and alerts resume when current clinical data are available' : `Historical replay through ${dateLabel(clinicalEnd)}`}</small>
                </span>
              </div>
              <span className={`warning-count ${clinicalAlerts.length ? 'active' : ''}`}>{clinicalLag > 7 ? '—' : clinicalAlerts.length}</span>
            </div>
            {clinicalLag > 7 ? <div className="alerts-paused">
              <ShieldCheck size={20} />
              <div>
                <strong>Current alerts paused</strong>
                <p>
                  The clinical snapshot ends {dateLabel(clinicalEnd)}.
                  Historical percentages remain visible when both seven-day
                  periods contain at least 10 encounters; low-count comparisons
                  are marked N/A.
                </p>
              </div>
            </div> : <div className="warning-list">{clinicalAlerts.length ? clinicalAlerts.map((alert) => <div className="warning-item" key={`${alert.region}-${alert.pathogen}`}><i className={alert.change! > .5 ? 'red' : 'yellow'}></i><span><strong>{alert.pathogen}</strong><small>{alert.region}</small></span><b>{alert.change! > .5 ? 'Red' : 'Yellow'} · +{(alert.change! * 100).toFixed(0)}%</b></div>) : <div className="empty-warning"><ShieldCheck size={16}/>No increases above the alert thresholds</div>}</div>}
          </section>
          <section className="vaccination-panel">
            <div className="panel-title">
              <div>
                <Syringe size={18} />
                <span>
                  <strong>COVID-19 vaccination coverage</strong>
                  <small>
                    Current seasonal coverage · FHM National Vaccination
                    Register
                  </small>
                </span>
              </div>
              <span className="panel-date">
                {vaccine ? dateLabel(vaccine.snapshotDate) : 'No prior snapshot'}
              </span>
            </div>
            {vaccine ? <><div className="coverage-grid">
              {['Östergötland', 'Jönköping', 'Kalmar'].map((region) => (
                <article key={region}>
                  <h3>{region}</h3>
                  {vaccine.records
                    .filter((r) => r.region === region)
                    .map((record) => (
                      <div className="coverage-row" key={record.ageGroup}>
                        <div>
                          <span>{record.ageGroup}</span>
                          <strong>{record.percent.toFixed(1)}%</strong>
                        </div>
                        <div className="coverage-track">
                          <i
                            style={{
                              width: `${(record.percent / maxCoverage) * 100}%`,
                            }}
                          />
                        </div>
                        <small>
                          {numberFmt.format(record.count)} vaccinated
                        </small>
                      </div>
                    ))}
                </article>
              ))}
            </div><p className="qualification">Latest stored FHM snapshot on or before the selected monitor date. VaccEval currently has {vaccination.snapshots.length} stored vaccination snapshot{vaccination.snapshots.length === 1 ? '' : 's'}; intermediate historical coverage cannot be reconstructed.</p></> : <div className="panel-unavailable"><Database size={18}/><span><strong>No vaccination snapshot available</strong><small>The first stored FHM snapshot is {dateLabel(vaccination.snapshots[0].snapshotDate)}.</small></span></div>}
          </section>
          <section className="mortality-panel">
            <div className="panel-title">
              <div>
                <HeartPulse size={18} />
                <span>
                  <strong>All-cause mortality</strong>
                  <small>
                    Context indicator · not attributable to a specific pathogen
                  </small>
                </span>
              </div>
              <span className="panel-date">
                Week ending {dateLabel(mortalityLatest)}
              </span>
            </div>
            <div className="mortality-grid">
              {mortalityCards.map((item) => (
                <article key={item.region}>
                  <span>{item.region}</span>
                  <strong>{item.count}</strong>
                  <small>
                    deaths ·{' '}
                    {item.change === null
                      ? 'change unavailable'
                      : `${item.change >= 0 ? '+' : ''}${item.change.toFixed(0)}% week over week`}
                  </small>
                </article>
              ))}
            </div>
            <p className="qualification">
              SCB figures for the latest calendar year are preliminary and
              subject to revision. This indicator provides health-system context
              and does not identify cause of death.
            </p>
          </section>
        </div>
        <aside className="source-panel">
          <div className="panel-title">
            <div>
              <Database size={18} />
              <span>
                <strong>Data source status</strong>
                <small>Coverage and publication timing</small>
              </span>
            </div>
          </div>
          {sources.map((source) => (
            <div className="source-row" key={source.name}>
              <span
                className={`source-dot ${source.state.toLowerCase().replace(' ', '-')}`}
              ></span>
              <div>
                <strong>{source.name}</strong>
                <small>{source.note}</small>
              </div>
              <div>
                <strong>{source.date ? dateLabel(source.date) : '—'}</strong>
                <small>{source.state}</small>
              </div>
            </div>
          ))}
          <div className="privacy-note">
            <ShieldCheck size={18} />
            <p>
              <strong>Aggregate outputs only</strong>
              <span>
                No personal identifiers or raw regional records are published in
                this interface.
              </span>
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}

function ExploreView({
  clinical,
  ww,
  cases,
}: {
  clinical: ClinicalData;
  ww: WWData;
  cases: CaseData;
}) {
  const [mode, setMode] = useState<Mode>('clinical'),
    [region, setRegion] = useState('Östergötland'),
    [pathogen, setPathogen] = useState('Influenza'),
    [analysisDate, setAnalysisDate] = useState('2025-02-15'),
    [model, setModel] = useState<Model>('weekoverweek'),
    [plotRange, setPlotRange] = useState<PlotRange>('3m');
  const aggregateCases = useMemo(() => withCaseAggregates(cases), [cases]),
    active =
      mode === 'clinical'
        ? clinical
        : mode === 'wastewater'
          ? ww
          : aggregateCases;
  const result = useMemo(() => {
    const base = active.series
      .filter((d: any) => d.region === region && d.pathogen === pathogen)
      .map((d: any) => ({
        date: d.date,
        value:
          mode === 'clinical'
            ? d.count
            : mode === 'wastewater'
              ? d.value
              : d.per100k,
      }));
    return base.length
      ? analyse(base, analysisDate, mode, model, plotRange)
      : null;
  }, [active, region, pathogen, analysisDate, mode, model, plotRange]);
  function changeMode(next: Mode) {
    setMode(next);
    const d =
      next === 'clinical'
        ? clinical
        : next === 'wastewater'
          ? ww
          : aggregateCases;
    setRegion(d.regions.includes(region) ? region : d.regions[0]);
    setPathogen(
      next === 'clinical'
        ? 'Influenza'
        : next === 'wastewater'
          ? 'Influenza A+B'
          : 'COVID-19',
    );
    setAnalysisDate(d.meta.dateRange[1]);
    if (next !== 'clinical') setModel('weekoverweek');
  }
  function move(days: number) {
    if (result)
      setAnalysisDate(
        clampDate(
          shift(result.date, days),
          active.meta.dateRange[0],
          result.maxDate,
        ),
      );
  }
  const clampDate = (d: string, a: string, b: string) =>
    d < a ? a : d > b ? b : d;
  if (!result) return null;
  const isWW = mode === 'wastewater',
    isCases = mode === 'cases',
    isWeekly = isWW || isCases,
    caseCurrent = isCases
      ? aggregateCases.series.find(
          (d) =>
            d.region === region &&
            d.pathogen === pathogen &&
            d.date === result.date,
        )
      : null,
    casePrevious = isCases
      ? aggregateCases.series.find(
          (d) =>
            d.region === region &&
            d.pathogen === pathogen &&
            d.date === shift(result.date, -7),
        )
      : null,
    changeAvailable =
      result.relativeChangeAvailable &&
      (!isCases ||
        ((caseCurrent?.count ?? 0) >= 10 && (casePrevious?.count ?? 0) >= 10)),
    trend = !changeAvailable
      ? result.slope > 0
        ? 'Increasing'
        : result.slope < 0
          ? 'Decreasing'
          : 'Stable'
      : Math.abs(result.relChange) < 0.1
        ? 'Stable'
        : result.relChange > 0
          ? 'Increasing'
          : 'Decreasing',
    reliability =
      result.reliability >= 0.67
        ? 'High'
        : result.reliability >= 0.33
          ? 'Moderate'
          : 'Low',
    unit = isWW
      ? 'PMMoV-normalized signal'
      : isCases
        ? 'reported cases per 100,000'
        : 'encounters per day';
  return (
    <section className="workspace explore-workspace">
      <div className="filterbar seven">
        <label>
          Data type
          <select
            value={mode}
            onChange={(e) => changeMode(e.target.value as Mode)}
          >
            <option value="clinical">Clinical</option>
            <option value="cases">Reported cases</option>
            <option value="wastewater">Wastewater</option>
          </select>
        </label>
        <label>
          Region
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            {active.regions.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Pathogen
          <select
            value={pathogen}
            onChange={(e) => setPathogen(e.target.value)}
          >
            {active.pathogens.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Age
          <select disabled>
            <option>All ages</option>
          </select>
        </label>
        <label>
          Sex
          <select disabled>
            <option>All sexes</option>
          </select>
        </label>
        <label>
          Model
          <select
            value={model}
            disabled={isWeekly}
            onChange={(e) => setModel(e.target.value as Model)}
          >
            <option value="weekoverweek">
              {isWeekly ? 'Weekly trend' : 'Week-over-week'}
            </option>
            {!isWeekly && <option value="linear">Local linear trend</option>}
          </select>
        </label>
        <label>
          Plot range
          <select
            value={plotRange}
            onChange={(e) => setPlotRange(e.target.value as PlotRange)}
          >
            <option value="3m">3 months</option>
            <option value="6m">6 months</option>
            <option value="1y">1 year</option>
            <option value="all">All history</option>
          </select>
        </label>
        <div className="date-control">
          <span>Historical replay</span>
          <div>
            <button aria-label="Previous period" onClick={() => move(-7)}>
              <ChevronLeft size={17} />
            </button>
            <input
              type="date"
              value={result.date}
              min={active.meta.dateRange[0]}
              max={result.maxDate}
              onChange={(e) => setAnalysisDate(e.target.value)}
            />
            <button aria-label="Next period" onClick={() => move(7)}>
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </div>
      <div className="metrics">
        <article>
          <span>Current level</span>
          <strong>{result.current.toPrecision(3)}</strong>
          <small>{unit}</small>
        </article>
        <article>
          <span>{isWeekly ? 'Weekly' : '7-day'} change</span>
          <strong
            className={
              changeAvailable
                ? result.relChange >= 0
                  ? 'up'
                  : 'down'
                : undefined
            }
          >
            {changeAvailable
              ? (result.relChange >= 0 ? '+' : '') +
                (result.relChange * 100).toFixed(0) +
                '%'
              : 'N/A'}
          </strong>
          <small>
            {!changeAvailable && isCases
              ? 'Too few reported cases'
              : isWeekly
                ? 'versus previous observation'
                : model === 'linear'
                  ? 'model projection'
                  : 'versus previous week'}
          </small>
        </article>
        <article>
          <span>Trend</span>
          <strong>{trend}</strong>
          <small>
            {Math.abs(result.slope).toPrecision(2)}{' '}
            {isWW
              ? 'signal/week'
              : isCases
                ? 'cases/100k/week'
                : 'encounters/day²'}
          </small>
        </article>
        <article>
          <span>Alert</span>
          <strong
            className={`alert ${(changeAvailable ? result.alert : 'Not assessed').toLowerCase().replace(' ', '-')}`}
          >
            <i></i>
            {changeAvailable ? result.alert : 'Not assessed'}
          </strong>
          <small>
            {changeAvailable
              ? '20% / 50% thresholds'
              : isCases
                ? 'Requires ≥10 cases in both weeks'
                : 'Previous level too close to zero'}
          </small>
        </article>
        <article>
          <span>Forecast reliability</span>
          <strong>{reliability}</strong>
          <small>
            {(result.reliability * 100).toFixed(0)}% score · NMAE{' '}
            {(result.nmae * 100).toFixed(0)}%
          </small>
        </article>
      </div>
      <div className="content-grid">
        <article className="chart-card">
          <div className="card-head">
            <div>
              <h2>Activity and short-term forecast</h2>
              <p>
                Real-time view uses only observations available on the analysis
                date.
              </p>
            </div>
            <div className="legend">
              <span className="dot observed"></span>
              {isWW ? 'Samples' : 'Daily encounters'}{' '}
              <span className="line smooth"></span>
              {isWW ? '2-sample mean' : '7-day mean'}{' '}
              <span className="line forecast"></span>Forecast
            </div>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={result.chart}
                margin={{ top: 18, right: 20, bottom: 4, left: -12 }}
              >
                <CartesianGrid
                  stroke="#dbe5e2"
                  strokeDasharray="3 5"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) =>
                    shortFmt.format(new Date(`${v}T12:00:00`))
                  }
                  minTickGap={38}
                  tick={{ fontSize: 11, fill: '#62716e' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#62716e' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  labelFormatter={dateLabel}
                  contentStyle={{
                    borderRadius: 10,
                    border: '1px solid #dbe5e2',
                  }}
                />
                <Area
                  dataKey="bandRange"
                  stroke="none"
                  fill="#a6c9c3"
                  fillOpacity={0.28}
                />
                <Line
                  dataKey="observed"
                  stroke="#a9b6b3"
                  strokeWidth={0}
                  dot={{ r: 2.5, fill: '#768581', stroke: 'none' }}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="smooth"
                  stroke="#123f3a"
                  strokeWidth={2.6}
                  dot={false}
                  connectNulls
                />
                <Line
                  dataKey="prediction"
                  stroke="#d16f3f"
                  strokeWidth={2.8}
                  strokeDasharray="7 5"
                  dot={false}
                  connectNulls
                />
                <ReferenceLine
                  x={result.date}
                  stroke="#8d9a97"
                  strokeDasharray="3 4"
                  label={{
                    value: 'Analysis date',
                    position: 'insideTopLeft',
                    fill: '#62716e',
                    fontSize: 11,
                  }}
                />
                {isWW && (
                  <ReferenceLine
                    x={ww.meta.methodChangeDate}
                    stroke="#b46a48"
                    strokeDasharray="2 3"
                    label={{
                      value: 'Method update',
                      position: 'insideBottomRight',
                      fill: '#9a5636',
                      fontSize: 10,
                    }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </article>
        <aside className="insight-card">
          <div className="insight-icon">
            <TrendingUp size={19} />
          </div>
          <p className="eyebrow">Model interpretation</p>
          <h2>
            {isWeekly
              ? changeAvailable
                ? `The latest ${isCases ? 'reported case rate' : 'wastewater level'} was ${Math.abs(result.relChange * 100).toFixed(0)}% ${result.relChange >= 0 ? 'higher' : 'lower'} than the previous observation.`
                : `A percentage change is not shown because ${isCases ? 'at least one week has fewer than 10 reported cases' : 'the previous level is too close to zero'}.`
              : model === 'linear'
                ? `The local trend projects a ${Math.abs(result.relChange * 100).toFixed(0)}% ${result.relChange >= 0 ? 'increase' : 'decrease'} over seven days.`
                : `The last week was ${Math.abs(result.relChange * 100).toFixed(0)}% ${result.relChange >= 0 ? 'higher' : 'lower'} than the week before.`}
          </h2>
          <p>
            {isWW
              ? 'Wastewater uses weekly PMMoV-normalized samples. Age and sex do not apply. Values from week 36 of 2026 use an updated laboratory method.'
              : isCases
                ? 'Reported laboratory-confirmed cases are shown per 100,000 residents. They depend on testing and reporting practices and do not represent all infections.'
                : model === 'linear'
                  ? 'A straight line is fitted to the last 14 causal seven-day means.'
                  : 'Two complete seven-day periods are compared to reduce weekday artefacts.'}
          </p>
          <div className="reliability">
            <div>
              <ShieldCheck size={18} />
              <span>
                Historical reliability<strong>{reliability}</strong>
              </span>
            </div>
            <div className="meter">
              <i style={{ width: `${result.reliability * 100}%` }}></i>
            </div>
            <small>Mean absolute error: {result.mae.toPrecision(3)}</small>
          </div>
        </aside>
      </div>
      <footer>
        <span>
          {isWW
            ? 'Open aggregate environmental surveillance data · No individual records'
            : 'Aggregate counts only · No personal identifiers included'}
        </span>
        <span>
          {active.meta.dateRange[0]} — {active.meta.dateRange[1]}
        </span>
      </footer>
    </section>
  );
}

function MethodologyPanel({
  clinical,
  ww,
  cases,
  vaccination,
  mortality,
  onClose,
}: {
  clinical: ClinicalData;
  ww: WWData;
  cases: CaseData;
  vaccination: VaccinationData;
  mortality: MortalityData;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);
  const vaccine = vaccination.snapshots.at(-1)!;
  return (
    <div className="method-backdrop" onMouseDown={onClose}>
      <aside
        className="method-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="method-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">How to interpret VaccEval</p>
            <h2 id="method-title">Methodology</h2>
          </div>
          <button aria-label="Close methodology" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="method-content">
          <section>
            <h3>Monitoring view</h3>
            <p>
              The virus overview combines weekly laboratory-confirmed cases per
              100,000 residents with unique healthcare encounters during each
              region’s latest complete seven-day period. Regional end dates are
              retained separately, so missing dates are never treated as zero
              activity. Historical monitor replay selects the most recent
              observation from each source available on or before the chosen
              date.
            </p>
          </section>
          <section>
            <h3>Reported virus cases</h3>
            <p>
              FHM/SmiNet counts include reported laboratory-confirmed COVID-19,
              influenza and RSV cases. Rates support regional comparison, while
              the adjacent absolute counts show scale. These observations depend
              on testing and reporting practices and do not estimate all
              infections.
            </p>
          </section>
          <section>
            <h3>Change percentages</h3>
            <p>
              Each percentage compares two consecutive, non-overlapping
              seven-day periods. A percentage is shown only when both periods
              contain at least 10 encounters; otherwise it is marked{' '}
              <strong>N/A</strong> because small denominators can produce
              misleading changes.
            </p>
          </section>
          <section>
            <h3>Warnings</h3>
            <p>
              Yellow indicates an increase above 20% and red an increase above
              50%. Current warnings are paused when the underlying clinical
              snapshot is stale. Historical percentages may still be displayed,
              but they are not presented as current alerts.
            </p>
          </section>
          <section>
            <h3>Exploratory models</h3>
            <p>
              Clinical analyses use either week-over-week comparison or a local
              linear trend fitted to the latest 14 causal seven-day means.
              Reported cases and wastewater use a two-observation causal mean
              and a short weekly projection. Case percentages and alerts require
              at least 10 reported cases in both weeks. Forecast reliability
              summarizes historical prediction error for the selected series.
              The plot range can be set to three months, six months, one year
              or the complete available history.
            </p>
          </section>
          <section>
            <h3>Sources and latest coverage</h3>
            <dl>
              <div>
                <dt>Cases</dt>
                <dd>
                  FHM/SmiNet · through {dateLabel(cases.meta.dateRange[1])}
                </dd>
              </div>
              <div>
                <dt>Clinical</dt>
                <dd>
                  Regional aggregate snapshot · through{' '}
                  {dateLabel(clinical.meta.dateRange[1])}
                </dd>
              </div>
              <div>
                <dt>Wastewater</dt>
                <dd>SLU/SEEC · through {dateLabel(ww.meta.dateRange[1])}</dd>
              </div>
              <div>
                <dt>Vaccination</dt>
                <dd>
                  FHM National Vaccination Register ·{' '}
                  {dateLabel(vaccine.snapshotDate)}
                </dd>
              </div>
              <div>
                <dt>Mortality</dt>
                <dd>
                  SCB preliminary weekly deaths · through{' '}
                  {dateLabel(mortality.meta.dateRange[1])}
                </dd>
              </div>
            </dl>
          </section>
          <section className="method-caution">
            <h3>Limitations</h3>
            <p>
              Signals support situational awareness; they do not establish
              causality or replace epidemiological and clinical assessment.
              Reporting delays, revisions, changing laboratory methods and
              healthcare-seeking behaviour can affect comparisons.
            </p>
          </section>
          <section className="method-privacy">
            <ShieldCheck size={18} />
            <div>
              <h3>Privacy</h3>
              <p>
                Only aggregate counts and derived indicators are published. Raw
                records and personal identifiers are not sent to the browser.
              </p>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

export default function Home() {
  const [clinical, setClinical] = useState<ClinicalData | null>(null),
    [ww, setWW] = useState<WWData | null>(null),
    [cases, setCases] = useState<CaseData | null>(null),
    [vaccination, setVaccination] = useState<VaccinationData | null>(null),
    [mortality, setMortality] = useState<MortalityData | null>(null),
    [view, setView] = useState<ViewMode>('monitor'),
    [methodOpen, setMethodOpen] = useState(false);
  useEffect(() => {
    Promise.all([
      fetch('/data/vacceval.json').then((r) => r.json()),
      fetch('/data/wastewater.json').then((r) => r.json()),
      fetch('/data/cases.json').then((r) => r.json()),
      fetch('/data/vaccination.json').then((r) => r.json()),
      fetch('/data/mortality.json').then((r) => r.json()),
    ]).then(([a, b, c, d, e]) => {
      setClinical(a);
      setWW(b);
      setCases(c);
      setVaccination(d);
      setMortality(e);
    });
  }, []);
  if (!clinical || !ww || !cases || !vaccination || !mortality)
    return <main className="loading">Loading VaccEval surveillance data…</main>;
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Activity size={19} />
          </span>
          <div>
            <strong>
              {view === 'monitor'
                ? 'VaccEval Surveillance Monitor'
                : 'VaccEval Explorer'}
            </strong>
          </div>
        </div>
        <nav className="view-switch" aria-label="Workspace mode">
          <button
            className={view === 'monitor' ? 'selected' : ''}
            onClick={() => setView('monitor')}
          >
            <LayoutDashboard size={15} />
            Monitor
          </button>
          <button
            className={view === 'explore' ? 'selected' : ''}
            onClick={() => setView('explore')}
          >
            <SlidersHorizontal size={15} />
            Explore
          </button>
        </nav>
        <div className="status">
          <span></span>Automated aggregate surveillance
        </div>
        <button className="method" onClick={() => setMethodOpen(true)}>
          Methodology
        </button>
      </header>
      {view === 'monitor' ? (
        <MonitorView
          clinical={clinical}
          ww={ww}
          cases={cases}
          vaccination={vaccination}
          mortality={mortality}
        />
      ) : (
        <ExploreView clinical={clinical} ww={ww} cases={cases} />
      )}
      <div className="acknowledgement">
        VaccEval results · Developed and maintained by{' '}
        <a href="https://signalprofessor.se" target="_blank" rel="noreferrer">
          Signalprofessor
        </a>
        .
      </div>
      {methodOpen && (
        <MethodologyPanel
          clinical={clinical}
          ww={ww}
          cases={cases}
          vaccination={vaccination}
          mortality={mortality}
          onClose={() => setMethodOpen(false)}
        />
      )}
    </main>
  );
}
