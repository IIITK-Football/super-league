// Match status helpers shared by the division home, the matches list and the timeline.
// Statuses come from the API: scheduled, live, completed, forfeited (forfeits are final and count in the table).
export const isLive = (match) => match?.status === 'live';
export const isFinal = (match) => match?.status === 'completed' || match?.status === 'forfeited';
export const isUpcoming = (match) => match?.status === 'scheduled';

const timeOf = (match) => (match?.date ? new Date(match.date).getTime() : NaN);

// The match a visitor sees first: a live match, else the next scheduled one, else the latest result.
export function pickHeroMatch(matches = [], now = Date.now()) {
  const live = matches.find(isLive);
  if (live) return { match: live, kind: 'live' };

  const upcoming = matches
    .filter((m) => isUpcoming(m) && !Number.isNaN(timeOf(m)))
    .sort((a, b) => timeOf(a) - timeOf(b));
  const next = upcoming.find((m) => timeOf(m) >= now) ?? upcoming[0];
  if (next) return { match: next, kind: 'next' };

  const results = matches
    .filter((m) => isFinal(m) && !Number.isNaN(timeOf(m)))
    .sort((a, b) => timeOf(b) - timeOf(a));
  if (results[0]) return { match: results[0], kind: 'result' };

  return null;
}

// Groups matches under their local calendar day, in the order given. Matches without a date form the last group.
export function groupByDate(matches = []) {
  const groups = [];
  const byDay = new Map();
  for (const match of matches) {
    const valid = !Number.isNaN(timeOf(match));
    const key = valid ? new Date(match.date).toDateString() : 'no-date';
    if (!byDay.has(key)) {
      const group = { key, date: valid ? new Date(match.date) : null, matches: [] };
      byDay.set(key, group);
      groups.push(group);
    }
    byDay.get(key).matches.push(match);
  }
  return groups.sort((a, b) => (a.date === null) - (b.date === null));
}

export const dayLabel = (date) => (date
  ? date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  : 'Date to be confirmed');

export const timeLabel = (date) => (date
  ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  : '');
