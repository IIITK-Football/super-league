// A clearly labelled stand-in for the reusable FUT card. It reads only the player identity shared
// across seasons (name, portrait, overall rating, attributes, play styles); season data such as the
// jersey number or position is shown beside it by the caller, never inside it.
export default function FutCardPlaceholder({ player }) {
  if (!player) return null;
  const name = [player.first_name, player.last_name].filter(Boolean).join(' ') || 'Unnamed player';
  const initials = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const attributes = player.attributes && typeof player.attributes === 'object' ? player.attributes : {};
  const stats = Object.entries(attributes)
    .filter(([key, value]) => key !== 'playStyles' && typeof value === 'number' && Number.isFinite(value))
    .slice(0, 6);
  const playStyles = Array.isArray(attributes.playStyles)
    ? attributes.playStyles.map((style) => style?.name).filter(Boolean)
    : [];

  return (
    <section aria-label="FUT card (placeholder)" className="rounded-xl border border-white/10 bg-black/30 p-4 text-white">
      <h4 className="text-[10px] uppercase tracking-widest text-white/50">FUT card · placeholder</h4>
      <p className="mt-1 text-xs text-white/40">
        Shared by this player in every season. The finished card design will replace this placeholder.
      </p>
      <div className="mt-3 flex items-center gap-3">
        {player.image_url ? (
          <img src={player.image_url} alt={`${name} portrait`} className="h-14 w-14 rounded-full object-cover" />
        ) : (
          <div aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-white/70">
            {initials}
          </div>
        )}
        <div>
          <p className="font-semibold">{name}</p>
          {player.overall_rating != null && (
            <p className="text-sm font-bold text-[#d9ff4a]">OVR {player.overall_rating}</p>
          )}
        </div>
      </div>
      {stats.length > 0 && (
        <dl className="mt-3 grid grid-cols-3 gap-2">
          {stats.map(([key, value]) => (
            <div key={key} className="rounded-lg bg-white/5 px-2 py-1 text-center">
              <dt className="text-[10px] uppercase tracking-widest text-white/50">{key.toUpperCase()}</dt>
              <dd className="text-sm font-bold">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {playStyles.length > 0 && (
        <p className="mt-3 text-xs text-white/60">Play styles: {playStyles.join(', ')}</p>
      )}
    </section>
  );
}
