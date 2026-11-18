import { useDivisions } from '../../hooks/useDivisions';

// Pill switch between divisions for admin tools, built from the divisions table.
export function DivisionSwitch({ value, onChange }) {
  const { divisions, loading, error } = useDivisions();
  if (error) return <p role="alert" className="text-center text-sm text-red-300">Could not load divisions: {error}</p>;
  if (loading) return <p className="text-center text-xs uppercase tracking-widest text-zinc-500">Loading divisions...</p>;
  if (!divisions.length) return <p className="text-center text-sm text-zinc-500">No divisions yet.</p>;
  return (
    <div className="bg-black/50 p-1 rounded-full border border-white/10 flex flex-wrap justify-center" role="group" aria-label="Division">
      {divisions.map((d) => (
        <button key={d.id} type="button" onClick={() => onChange(d.slug)} aria-pressed={value === d.slug}
          className={`px-6 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all ${value === d.slug ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}>
          {d.name}
        </button>
      ))}
    </div>
  );
}
