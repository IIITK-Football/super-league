import { PLAY_STYLES } from '../data/playStyles';

// The FUT card fields in players.attributes (the reusable player identity, shared across seasons). One canonical
// shape, enforced by the database (players_attributes_canonical) and used by the player card, the team builder and
// the dictator form:
//   { stats: { Pace | Shooting | Passing | Dribbling | Defending | Physicality: { total: 1..99, ... } },
//     bio: { preferredFoot: 'Right' | 'Left' | 'Both', ... },
//     playStyle: '<one catalog name>' (absent when not set; icons and descriptions come from the catalog),
//     ...any other key }
// canonicalAttributes mirrors public.canonical_player_attributes: older flat numbers ({ pace: 59 }) move into stats,
// and anything that cannot take its canonical place is kept under `legacy`, never dropped. Nothing is invented.
export const CARD_STATS = [
  { key: 'Pace', short: 'PAC' },
  { key: 'Shooting', short: 'SHO' },
  { key: 'Passing', short: 'PAS' },
  { key: 'Dribbling', short: 'DRI' },
  { key: 'Defending', short: 'DEF' },
  { key: 'Physicality', short: 'PHY' },
];
export const FEET = ['Right', 'Left', 'Both'];
const STAT_KEYS = CARD_STATS.map((s) => s.key);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isStat = (value) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 99;

export function canonicalAttributes(stored) {
  if (stored === null || stored === undefined) return {};
  if (!isObject(stored)) return { legacy: { attributes: stored } };
  const result = { ...stored };
  const legacy = isObject(stored.legacy) ? { ...stored.legacy } : {};

  const stats = isObject(stored.stats) ? { ...stored.stats } : {};
  if ('stats' in stored && !isObject(stored.stats)) legacy.stats = stored.stats;
  for (const key of Object.keys(stats)) {
    const entry = stats[key];
    if (!STAT_KEYS.includes(key) || !isObject(entry) || ('total' in entry && !isStat(entry.total))) {
      legacy[`stats_${key}`] = entry;
      delete stats[key];
    }
  }
  for (const key of STAT_KEYS) {
    const flat = key.toLowerCase();
    if (!(flat in result)) continue;
    const value = result[flat];
    if (isStat(value) && !(isObject(stats[key]) && 'total' in stats[key])) stats[key] = { ...(stats[key] || {}), total: value };
    else legacy[flat] = value;
    delete result[flat];
  }
  if (Object.keys(stats).length) result.stats = stats; else delete result.stats;

  if ('bio' in result) {
    if (!isObject(result.bio)) { legacy.bio = result.bio; delete result.bio; }
    else if ('preferredFoot' in result.bio) {
      const raw = result.bio.preferredFoot;
      const foot = typeof raw === 'string' ? raw.trim().charAt(0).toUpperCase() + raw.trim().slice(1).toLowerCase() : null;
      const bio = { ...result.bio };
      if (FEET.includes(foot)) bio.preferredFoot = foot;
      else { legacy.preferredFoot = raw; delete bio.preferredFoot; }
      result.bio = bio;
    }
  }


  if (Object.keys(legacy).length) result.legacy = legacy; else delete result.legacy;
  return result;
}

export const statValue = (attributes, key) => {
  const total = canonicalAttributes(attributes).stats?.[key]?.total;
  return isStat(total) ? total : null;
};

// The editable card fields of stored attributes, as form values (strings for inputs; empty means not set).
export function cardDraft(stored) {
  const a = canonicalAttributes(stored);
  return {
    stats: Object.fromEntries(STAT_KEYS.map((key) => [key, isStat(a.stats?.[key]?.total) ? String(a.stats[key].total) : ''])),
    preferredFoot: a.bio?.preferredFoot || '',
    playStyle: catalogStyle(a.playStyle)?.name || '',
  };
}

export const blankCardDraft = () => cardDraft({});

// The catalog entry for a stored play-style name (a player has one play style, or none).
export const catalogStyle = (name) => (typeof name === 'string' ? PLAY_STYLES.find((s) => s.name === name) : null) || null;

// The attributes to save: the stored value in canonical form with the form's card fields applied. Every other key is
// kept. Returns { error } for invalid input.
export function applyCardDraft(stored, draft) {
  const a = canonicalAttributes(stored);
  const stats = { ...(a.stats || {}) };
  for (const key of STAT_KEYS) {
    const text = String(draft.stats[key] ?? '').trim();
    if (text === '') {
      if (stats[key]) {
        const rest = { ...stats[key] };
        delete rest.total;
        if (Object.keys(rest).length) stats[key] = rest; else delete stats[key];
      }
      continue;
    }
    const n = Number(text);
    if (!isStat(n)) return { error: `${key} must be a whole number between 1 and 99, or empty.` };
    stats[key] = { ...(stats[key] || {}), total: n };
  }
  const bio = { ...(a.bio || {}) };
  if (draft.preferredFoot) bio.preferredFoot = draft.preferredFoot; else delete bio.preferredFoot;
  const next = { ...a };
  if (Object.keys(stats).length) next.stats = stats; else delete next.stats;
  if (Object.keys(bio).length) next.bio = bio; else delete next.bio;
  if (draft.playStyle) next.playStyle = draft.playStyle; else delete next.playStyle;
  return { value: next };
}
