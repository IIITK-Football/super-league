/* eslint-disable react/prop-types -- this codebase does not use prop-types */
import { Select } from './ui';

// Season picker for a division page. Shown only when the division has more than one available season.
export function SeasonSelect({ seasons, value, onChange }) {
  if (!seasons || seasons.length < 2) return null;
  return (
    <div className="flex items-center gap-3">
      <span className="eyebrow">Season</span>
      <Select
        aria-label="Season"
        className="min-w-48"
        value={value || ''}
        onChange={onChange}
        options={seasons.map((season) => ({ value: season.slug, label: season.name, description: season.is_current ? 'Current' : undefined }))}
      />
    </div>
  );
}
