// Season picker for a division page. Shown only when the division has more than one available season.
export function SeasonSelect({ seasons, value, onChange }) {
  if (!seasons || seasons.length < 2) return null;
  return (
    <label className="inline-flex items-center gap-3 rounded-full border border-white/20 bg-black/80 px-5 py-2 backdrop-blur-xl">
      <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Season</span>
      <select
        aria-label="Season"
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        className="cursor-pointer bg-transparent text-xs font-black uppercase tracking-widest text-white outline-none"
      >
        {seasons.map((season) => (
          <option key={season.id} value={season.slug} className="bg-black text-white">
            {season.name}{season.is_current ? ' (current)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
