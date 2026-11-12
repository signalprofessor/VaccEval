'use client';

export type ExploreMode = 'clinical' | 'wastewater' | 'cases' | 'inpatient' | 'outpatient' | 'total';
export default function ExploreSourceSelect({ value, onChange }: { value: ExploreMode; onChange: (value: ExploreMode) => void }) {
  return <label>Data type<select value={value} onChange={(event) => onChange(event.target.value as ExploreMode)}>
    <option value="inpatient">Admitted cases (inpatient)</option>
    <option value="outpatient">Policlinical cases (outpatient)</option>
    <option value="total">Total diagnosed cases</option>
    <option value="clinical">VaccEval data (historical archive)</option>
    <option value="cases">Lab-confirmed cases (FoHM)</option>
    <option value="wastewater">Wastewater</option>
  </select></label>;
}
