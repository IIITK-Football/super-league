/* eslint-disable react/prop-types -- this codebase does not use prop-types */
// Season picker for a division page. Shown only when the division has more than one available season.
export function SeasonSelect({ seasons, value, onChange }) {
  if (!seasons || seasons.length < 2) return null;
  return (
    <label className="glass inline-flex min-h-11 items-center gap-3 rounded-pill px-4">
      <span className="eyebrow">Season</span>
      <select
        aria-label="Season"
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        className="cursor-pointer bg-transparent font-bold uppercase tracking-wider text-ink outline-none"
      >
        {seasons.map((season) => (
          <option key={season.id} value={season.slug}>
            {season.name}{season.is_current ? ' (current)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
