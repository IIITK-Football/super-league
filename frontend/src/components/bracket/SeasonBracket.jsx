import { MatchStrip } from '../match/MatchStrip';

// Knockout rounds in play order, keyed by the match's stage. Labels come from here, never from a slot position.
export const KNOCKOUT_ROUNDS = [
  { stage: 'quarter_final', label: 'Quarter-finals' },
  { stage: 'eliminator', label: 'Eliminator' },
  { stage: 'semi_final', label: 'Semi-finals' },
  { stage: 'final', label: 'Final' },
  { stage: 'third_place', label: 'Third place play-off' },
];

// The season's knockout rounds that have matches. Nothing is invented: a round with no matches is left out.
// shortcut: matches carry no stage column yet, so this is empty until the season data supplies one.
export function bracketRounds(matches = []) {
  return KNOCKOUT_ROUNDS
    .map((round) => ({ ...round, matches: matches.filter((m) => m.stage === round.stage) }))
    .filter((round) => round.matches.length > 0);
}

// The knockout bracket of a season, or nothing when the season has no knockout data.
export function SeasonBracket({ matches = [] }) {
  const rounds = bracketRounds(matches);
  if (rounds.length === 0) return null;

  return (
    <section aria-labelledby="bracket-heading" className="space-y-5">
      <h2 id="bracket-heading" className="font-display text-3xl text-ink sm:text-4xl">Knockout</h2>
      <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-4">
        {rounds.map((round) => (
          <div key={round.stage} className="space-y-4">
            <h3 className="eyebrow">{round.label}</h3>
            {round.matches.map((match) => <MatchStrip key={match.id} match={match} className="h-full" />)}
          </div>
        ))}
      </div>
    </section>
  );
}
