import { Shield } from 'lucide-react';
import { CARD_STATS, canonicalAttributes, catalogStyle, statValue } from '../../lib/playerCard';
import styles from '../PlayerProfile.module.css';

// The player's FUT card, shared by the Clubs player page and the dictator's Teams & Rosters forms. It shows the
// reusable player identity (portrait, name, overall rating, card stats, the first play style's icon). `position` is
// optional season context for the corner (the Clubs page shows it); the dictator forms show season data beside the
// card instead. `player` may be a saved player or an unsaved draft.
// `details` adds the preferred foot and play-style names under the card (the dictator forms use it).
// `portrait` previews a picture that is not saved yet: { url, status: 'local' | 'uploading' | 'failed' }.
// Empty values show as a dash: the card never invents a number.
const PORTRAIT_NOTES = {
  local: 'New picture: not saved yet',
  uploading: 'Uploading the new picture...',
  failed: 'The new picture did not save',
};

export const cardBackground = (rating) => {
  const num = parseInt(rating, 10) || 50;
  if (num >= 85) return "url('/gold.png')";
  if (num >= 70) return "url('/silver.png')";
  return "url('/bronze.png')";
};
const cardTextColor = (rating) => {
  const num = parseInt(rating, 10) || 50;
  if (num >= 85) return 'text-amber-950';
  if (num >= 70) return 'text-zinc-900';
  return 'text-orange-950';
};

/* eslint-disable react/prop-types -- this codebase does not use prop-types */
export default function FutCard({ player, position, portrait, details = false }) {
  if (!player) return null;
  const attributes = canonicalAttributes(player.attributes);
  const rating = player.overall_rating === '' || player.overall_rating == null ? null : Number(player.overall_rating);
  const text = cardTextColor(rating);
  const name = String(player.first_name || player.last_name || '').trim();
  const fullName = [player.first_name, player.last_name].map((p) => String(p || '').trim()).filter(Boolean).join(' ') || 'Unnamed player';
  const image = portrait?.url || player.image_url;
  const firstStyle = Array.isArray(attributes.playStyles) ? attributes.playStyles[0] : null;
  const styleIcon = firstStyle && (firstStyle.icon_url || catalogStyle(firstStyle.name)?.imageUrl);
  const noDrag = { onContextMenu: (e) => e.preventDefault(), draggable: 'false' };

  return (
    <figure aria-label={`FUT card: ${fullName}`} className="m-0 grid justify-items-center gap-2">
      <div className="relative w-max drop-shadow-2xl">
        <div className="relative z-10 h-[380px] w-[260px] select-none overflow-hidden bg-center bg-no-repeat"
          style={{ backgroundImage: cardBackground(rating), backgroundSize: '100% 100%' }}>
          <div className={`absolute left-[16%] top-[22%] z-10 flex flex-col items-start ${text}`}>
            <span className="text-4xl font-black leading-none tabular-nums" data-testid="card-rating">{rating ?? '—'}</span>
            {position && <span className="text-sm font-bold uppercase tracking-wider">{position}</span>}
          </div>
          <div className="absolute left-0 top-[18%] flex w-full justify-center">
            {image
              ? <img src={image} alt={`${fullName} portrait`} className="h-[175px] select-none object-contain drop-shadow-2xl" {...noDrag} />
              : <Shield aria-hidden="true" className={`h-[175px] w-auto opacity-40 ${text}`} />}
          </div>
          <div className={`absolute bottom-[28%] left-0 w-full text-center ${text}`}>
            <div className="text-[14px] font-black uppercase tracking-widest">{name || '—'}</div>
          </div>
          <div className={`absolute bottom-[19%] left-0 w-full px-6 ${text}`}>
            <dl className={`m-0 text-center ${styles.cardStatsGrid}`}>
              {CARD_STATS.map(({ key, short }) => (
                <div key={key} className="grid grid-rows-2 justify-items-center">
                  <dt className="text-[9px] font-bold opacity-80">{short}</dt>
                  <dd className="m-0 text-[15px] font-black leading-none">{statValue(attributes, key) ?? '—'}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        {styleIcon && <img src={styleIcon} alt={firstStyle.name}
          className="absolute left-[26px] top-[48%] z-20 h-8 w-8 -translate-x-1/2 -translate-y-1/2 object-contain" {...noDrag} />}
      </div>
      {details && <figcaption className="max-w-[260px] text-center text-xs text-zinc-400">
        <span>Preferred foot: {attributes.bio?.preferredFoot || 'not set'}</span><br />
        <span>Play styles: {Array.isArray(attributes.playStyles) && attributes.playStyles.length ? attributes.playStyles.map((st) => st.name).join(', ') : 'none'}</span>
      </figcaption>}
      {portrait?.status && <figcaption className={`text-xs ${portrait.status === 'failed' ? 'text-red-300' : 'text-amber-200'}`}>{PORTRAIT_NOTES[portrait.status]}</figcaption>}
    </figure>
  );
}
/* eslint-enable react/prop-types */
