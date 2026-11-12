// Original artwork from SÖSR's header, with viewports showing only the symbols.
// https://sydostrasjukvardsregionen.se/wp-content/uploads/2020/10/logoalla-regioner.png
const symbols = [
  { name: 'Region Jönköpings län', viewBox: '-3 20 126 128', width: 32 },
  { name: 'Region Kalmar län', viewBox: '682 -4 130 105', width: 40 },
  { name: 'Region Östergötland', viewBox: '992 16 134 134', width: 34 },
];

export default function RegionSymbols() {
  return <div className="region-symbols" role="group" aria-label="Regions of South-Eastern Sweden">
    {symbols.map(({ name, viewBox, width }) => <span className="region-symbol" role="img" aria-label={name} title={name} key={name}>
      <svg viewBox={viewBox} width={width} height="34" aria-hidden="true" focusable="false" overflow="hidden">
        <image href="/branding/sosr-regions.png" width="1500" height="150" />
      </svg>
    </span>)}
  </div>;
}
